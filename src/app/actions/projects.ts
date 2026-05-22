"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import { enqueueAdminNewProjectNotification, enqueueProjectDecisionNotification } from "@/lib/notifications";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import { slugify } from "@/lib/utils";

// Pre-process empty strings to `undefined` so blank optional URL fields don't
// trip the `.url()` validator.
const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional(),
);

const ProjectInputSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(10).max(5000),
  tags: z.array(z.string().min(1).max(30)).max(10).default([]),
  appUrl: z.string().url(),
  repoUrl: optionalUrl,
  demoVideoUrl: optionalUrl,
  thumbnailPath: z.string().optional(),
  screenshots: z.array(z.string()).max(8).default([]),
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
    appUrl: parsed.appUrl,
    repoUrl: parsed.repoUrl || "",
    demoVideoUrl: parsed.demoVideoUrl || "",
    thumbnailPath: parsed.thumbnailPath ?? "",
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
  const cur = snap.data() as { ownerUid: string };
  if (cur.ownerUid !== user.uid) throw new Error("FORBIDDEN");

  // Editing flips back to pending for re-review.
  await ref.update({
    title: parsed.title,
    description: parsed.description,
    tags: parsed.tags,
    appUrl: parsed.appUrl,
    repoUrl: parsed.repoUrl || "",
    demoVideoUrl: parsed.demoVideoUrl || "",
    thumbnailPath: parsed.thumbnailPath ?? "",
    screenshots: parsed.screenshots,
    status: "pending" as const,
    submittedAt: Timestamp.now(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  revalidatePath("/showcase");
  revalidatePath("/my/projects");
  revalidatePath("/admin/projects");
}

export async function deleteMyProject(projectId: string): Promise<void> {
  const user = await requireUser();
  const ref = adminDb().collection("projects").doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as { ownerUid: string };
  if (cur.ownerUid !== user.uid) throw new Error("FORBIDDEN");
  await ref.delete();
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
