"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import {
  enqueueAdminNewProjectNotification,
  enqueueProjectDecisionNotification,
} from "@/lib/notifications";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { slugify } from "@/lib/utils";
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

const ProjectInputSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(10).max(5000),
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

function parseProjectInput(
  input: ProjectFormInput,
): z.infer<typeof ProjectInputSchema> {
  const result = ProjectInputSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

async function uniqueSlug(base: string, existingId?: string): Promise<string> {
  const slug = slugify(base);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i}`;
    const snap = await adminDb()
      .collection("projects")
      .where("slug", "==", candidate)
      .limit(1)
      .get();
    if (snap.empty || snap.docs[0].id === existingId) return candidate;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

// Best-effort Storage cleanup. Logged and swallowed so a single missing object
// can't block a metadata write or a doc deletion.
async function deleteStoragePaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const bucket = adminStorage().bucket();
  await Promise.all(
    paths.map((p) =>
      bucket
        .file(p)
        .delete()
        .catch((err) => {
          console.warn("Failed to delete storage object:", p, err);
        }),
    ),
  );
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

export async function submitProject(input: ProjectFormInput): Promise<string> {
  const user = await requireUser();
  const parsed = parseProjectInput(input);
  const now = Timestamp.now();
  const slug = await uniqueSlug(parsed.title);

  const ref = await adminDb().collection("projects").add({
    slug,
    ownerUid: user.uid,
    ownerName: user.displayName,
    title: parsed.title,
    description: parsed.description,
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

  revalidatePath("/showcase");
  revalidatePath("/my/projects");
  revalidatePath("/admin/projects");
  redirect(`/my/projects`);
}

export async function updateMyProject(
  projectId: string,
  input: ProjectFormInput,
): Promise<void> {
  const user = await requireUser();
  const parsed = parseProjectInput(input);
  const ref = adminDb().collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as ProjectDoc;
  if (cur.ownerUid !== user.uid) throw new Error("FORBIDDEN");

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

  // Editing flips back to pending for re-review. Explicitly delete the
  // legacy `thumbnailPath` field on first save so the doc normalizes to
  // the new shape (PR #24 introduced thumbnail: { path, url } in its
  // place).
  await ref.update({
    title: parsed.title,
    description: parsed.description,
    tags: parsed.tags,
    appUrl: parsed.appUrl || "",
    repoUrl: parsed.repoUrl || "",
    demoVideoUrl: parsed.demoVideoUrl || "",
    thumbnail: parsed.thumbnail ?? FieldValue.delete(),
    screenshots: parsed.screenshots,
    thumbnailPath: FieldValue.delete(),
    status: "pending" as const,
    submittedAt: Timestamp.now(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (orphans.length > 0) await deleteStoragePaths(orphans);

  revalidatePath("/showcase");
  revalidatePath("/my/projects");
  revalidatePath("/admin/projects");
}

export async function deleteMyProject(projectId: string): Promise<void> {
  const user = await requireUser();
  const ref = adminDb().collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as ProjectDoc;
  if (cur.ownerUid !== user.uid) throw new Error("FORBIDDEN");

  // Collect the asset paths now, but defer the Storage cleanup until AFTER
  // the doc is deleted. If the Storage cleanup runs first and the doc
  // delete then fails (transient error), retrying would have nothing to
  // clean up and we'd be left with a doc pointing at missing files.
  const paths: string[] = [];
  if (cur.thumbnail) paths.push(cur.thumbnail.path);
  for (const s of cur.screenshots ?? []) paths.push(s.path);

  await ref.delete();
  if (paths.length > 0) await deleteStoragePaths(paths);

  revalidatePath("/showcase");
  revalidatePath("/my/projects");
}

export async function decideProject(
  projectId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<void> {
  const admin = await requireAdmin();
  const ref = adminDb().collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as { ownerUid: string; title: string };

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

  revalidatePath("/showcase");
  revalidatePath("/admin/projects");
}
