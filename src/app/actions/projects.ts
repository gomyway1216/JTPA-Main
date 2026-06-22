"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath, updateTag } from "next/cache";
import * as z from "zod";

import {
  enqueueAdminNewProjectNotification,
  enqueueModerationDecisionNotification,
  enqueueProjectDecisionNotification,
} from "@/lib/notifications";
import {
  deleteStoragePaths,
  findUniqueSlug,
  parseInput,
} from "@/lib/actions/shared";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import {
  CONTENT_LOCALES,
  DEFAULT_CONTENT_LOCALES,
} from "@/lib/content-localization";
import { PROJECTS_TAG } from "@/lib/data/cache-tags";
import { adminDb } from "@/lib/firebase/admin";
import { routing } from "@/i18n/routing";
import { actionError } from "@/lib/i18n/action-errors";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import type { ProjectAsset, ProjectDoc } from "@/lib/types";

// Pre-process empty strings to `undefined` so blank optional URL fields don't
// trip the `.url()` validator.
const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional(),
);

const AssetSchema = z.object({
  path: z.string().min(1),
  url: z.string().url(),
});

function revalidateLocalizedPath(path: string): void {
  revalidatePath(path);
  for (const locale of routing.locales) {
    revalidatePath(`/${locale}${path}`);
  }
}

// Expire the cross-request data cache for /, /showcase and
// /showcase/[slug] (see src/lib/data/cached.ts). The collection tag also
// covers public list caches and per-slug detail entries. The
// revalidateLocalizedPath calls in each action remain for client-router
// refresh semantics.
function expireProjectCache() {
  updateTag(PROJECTS_TAG);
}

const ProjectInputSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(10).max(5000),
  locales: z
    .array(z.enum(CONTENT_LOCALES))
    .min(1)
    .max(CONTENT_LOCALES.length)
    .default([...DEFAULT_CONTENT_LOCALES])
    .transform((locales) => [...new Set(locales)]),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
  // appUrl optional: per #38, projects can be CLI tools, local-only
  // experiments, hardware demos, etc. — not every project has a public
  // app URL. Empty string from the form is preprocessed to undefined by
  // optionalUrl, same as repoUrl/demoVideoUrl.
  appUrl: optionalUrl,
  repoUrl: optionalUrl,
  demoVideoUrl: optionalUrl,
  thumbnail: AssetSchema.optional(),
  screenshots: z.array(AssetSchema).max(8).default([]),
});

export type ProjectFormInput = z.input<typeof ProjectInputSchema>;
export type ProjectReturnTo = "my" | "admin";

// submitProject / updateMyProject redirect on success (so they only ever
// *return* on failure); the remaining actions return { ok: true }. Returning
// the error rather than throwing it is what lets the real message reach the
// user — Next masks thrown Server Action errors as a generic digest in
// production (same reasoning as events.ts / users.ts, per PR #59).
export type ProjectSaveResult = { ok: true } | { ok: false; error: string };

function projectReturnPath(returnTo: ProjectReturnTo, isAdmin: boolean): string {
  return returnTo === "admin" && isAdmin ? "/admin/projects" : "/my/projects";
}

function diffAssetPaths(
  prev: ProjectAsset[] | undefined,
  next: ProjectAsset[],
  prevSingle?: ProjectAsset,
  nextSingle?: ProjectAsset,
): string[] {
  const nextPaths = new Set<string>();
  for (const a of next) nextPaths.add(a.path);
  if (nextSingle) nextPaths.add(nextSingle.path);
  const orphans: string[] = [];
  for (const a of prev ?? []) if (!nextPaths.has(a.path)) orphans.push(a.path);
  if (prevSingle && !nextPaths.has(prevSingle.path)) orphans.push(prevSingle.path);
  return orphans;
}

export async function submitProject(
  input: ProjectFormInput,
): Promise<ProjectSaveResult> {
  const user = await requireUser();
  const pr = await parseInput(ProjectInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
  const now = Timestamp.now();
  const slug = await findUniqueSlug("projects", parsed.title);

  const ref = await adminDb().collection("projects").add({
    slug,
    ownerUid: user.uid,
    ownerName: user.displayName,
    title: parsed.title,
    description: parsed.description,
    locales: parsed.locales,
    tags: parsed.tags,
    appUrl: parsed.appUrl || "",
    repoUrl: parsed.repoUrl || "",
    demoVideoUrl: parsed.demoVideoUrl || "",
    thumbnail: parsed.thumbnail,
    screenshots: parsed.screenshots,
    status: "pending" as const,
    reviewerUid: null,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await enqueueAdminNewProjectNotification({
    projectId: ref.id,
    title: parsed.title,
    ownerName: user.displayName,
    ownerEmail: user.email,
  });

  expireProjectCache();
  revalidateLocalizedPath("/showcase");
  revalidateLocalizedPath("/my/projects");
  revalidateLocalizedPath("/admin/projects");
  return redirectToLocalizedPath("/my/projects");
}

export async function updateMyProject(
  projectId: string,
  input: ProjectFormInput,
  returnTo: ProjectReturnTo = "my",
): Promise<ProjectSaveResult> {
  const user = await requireUser();
  const pr = await parseInput(ProjectInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
  const ref = adminDb().collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("projectNotFound") };
  const cur = snap.data() as ProjectDoc;
  if (cur.ownerUid !== user.uid && !user.isAdmin) {
    return { ok: false, error: await actionError("projectEditForbidden") };
  }

  // Compute orphans now — they're whatever paths the previous version
  // referenced but the new payload doesn't — but defer the actual Storage
  // delete until AFTER the Firestore write succeeds. Otherwise a failed
  // update would leave a doc pointing at already-deleted Storage objects.
  const orphans = diffAssetPaths(
    cur.screenshots,
    parsed.screenshots,
    cur.thumbnail,
    parsed.thumbnail,
  );

  // Owner edits flip back to pending for re-review. Admin edits preserve
  // the current moderation state so typo fixes do not accidentally hide a
  // published project or revive a rejected one.
  const nextStatus: ProjectDoc["status"] = user.isAdmin ? cur.status : "pending";

  // Explicitly delete the legacy `thumbnailPath` field on first save so the
  // doc normalizes to the new shape (PR #24 introduced thumbnail: { path,
  // url } in its place).
  await ref.update({
    title: parsed.title,
    description: parsed.description,
    locales: parsed.locales,
    tags: parsed.tags,
    appUrl: parsed.appUrl || "",
    repoUrl: parsed.repoUrl || "",
    demoVideoUrl: parsed.demoVideoUrl || "",
    thumbnail: parsed.thumbnail ?? FieldValue.delete(),
    screenshots: parsed.screenshots,
    thumbnailPath: FieldValue.delete(),
    status: nextStatus,
    ...(!user.isAdmin ? { submittedAt: Timestamp.now() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (orphans.length > 0) await deleteStoragePaths(orphans);

  expireProjectCache();
  revalidateLocalizedPath("/showcase");
  revalidateLocalizedPath(`/showcase/${cur.slug}`);
  revalidateLocalizedPath("/my/projects");
  revalidateLocalizedPath("/admin/projects");
  // Redirect on success — mirrors updateMyPost so the author lands back on
  // their list instead of sitting on a now-stale edit form (per #129 review).
  return redirectToLocalizedPath(projectReturnPath(returnTo, user.isAdmin));
}

export async function deleteMyProject(
  projectId: string,
): Promise<ProjectSaveResult> {
  const user = await requireUser();
  const ref = adminDb().collection("projects").doc(projectId);
  const snap = await ref.get();
  // Already gone — nothing to do, treat as success so the UI navigates away.
  if (!snap.exists) return { ok: true };
  const cur = snap.data() as ProjectDoc;
  if (cur.ownerUid !== user.uid && !user.isAdmin) {
    return { ok: false, error: await actionError("projectDeleteForbidden") };
  }

  // Collect the asset paths now, but defer the Storage cleanup until AFTER
  // the doc is deleted. If the Storage cleanup runs first and the doc
  // delete then fails (transient error), retrying would have nothing to
  // clean up and we'd be left with a doc pointing at missing files.
  const paths: string[] = [];
  if (cur.thumbnail) paths.push(cur.thumbnail.path);
  for (const s of cur.screenshots ?? []) paths.push(s.path);

  await ref.delete();
  if (paths.length > 0) await deleteStoragePaths(paths);

  expireProjectCache();
  revalidateLocalizedPath("/showcase");
  revalidateLocalizedPath(`/showcase/${cur.slug}`);
  revalidateLocalizedPath("/my/projects");
  revalidateLocalizedPath("/admin/projects");
  return { ok: true };
}

export async function setProjectVisibility(
  projectId: string,
  visible: boolean,
): Promise<ProjectSaveResult> {
  const admin = await requireAdmin();
  const ref = adminDb().collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("projectNotFound") };
  const cur = snap.data() as ProjectDoc;

  await ref.update({
    status: visible ? ("approved" as const) : ("archived" as const),
    reviewerUid: admin.uid,
    ...(visible ? { reviewNote: "" } : {}),
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  expireProjectCache();
  revalidateLocalizedPath("/showcase");
  revalidateLocalizedPath(`/showcase/${cur.slug}`);
  revalidateLocalizedPath("/my/projects");
  revalidateLocalizedPath("/admin/projects");
  return { ok: true };
}

export async function decideProject(
  projectId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<ProjectSaveResult> {
  const admin = await requireAdmin();
  const ref = adminDb().collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("projectNotFound") };
  const cur = snap.data() as { ownerUid: string; title: string; slug: string };

  await ref.update({
    status: decision,
    reviewerUid: admin.uid,
    reviewNote: note ?? "",
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Notify owner of decision.
  const ownerSnap = await adminDb()
    .collection("users")
    .doc(cur.ownerUid)
    .get();
  const ownerEmail = ownerSnap.exists ? (ownerSnap.data()?.email as string) : null;
  if (ownerEmail) {
    await enqueueProjectDecisionNotification({
      to: ownerEmail,
      title: cur.title,
      decision,
      note,
    });
  }
  await enqueueModerationDecisionNotification({
    recipientUid: cur.ownerUid,
    reason: decision === "approved" ? "project_approved" : "project_rejected",
    actorUid: admin.uid,
    actorName: admin.displayName,
    actorPhotoURL: admin.photoURL,
    parentType: "project",
    parentId: projectId,
    parentTitle: cur.title,
    parentSlug: cur.slug,
    moderationNote: decision === "rejected" ? note : undefined,
    createdAt: Timestamp.now(),
  }).catch((err) => {
    console.warn("Failed to enqueue project decision in-app notification:", err);
  });

  expireProjectCache();
  revalidateLocalizedPath("/showcase");
  revalidateLocalizedPath("/admin/projects");
  return { ok: true };
}
