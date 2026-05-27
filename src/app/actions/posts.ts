"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import {
  enqueueAdminNewPostNotification,
  enqueuePostDecisionNotification,
} from "@/lib/notifications";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import { slugify } from "@/lib/utils";
import type { PostDoc, PostStatus, ProjectAsset } from "@/lib/types";

const AssetSchema = z.object({
  path: z.string().min(1),
  url: z.string().url(),
});

// Author-facing intents. "draft" and "pending" are the only states an
// author can transition into via the form; admins use the dedicated
// `publishPost` / `decidePost` actions for the rest.
const SubmitIntent = z.enum(["draft", "pending"]);

const PostInputSchema = z.object({
  title: z.string().min(2).max(200),
  excerpt: z.string().min(1).max(300),
  body: z.string().min(1).max(50_000),
  tags: z.array(z.string().min(1).max(30)).max(8).default([]),
  coverImage: AssetSchema.optional(),
  intent: SubmitIntent.default("pending"),
});

export type PostFormInput = z.input<typeof PostInputSchema>;

function parsePostInput(
  input: PostFormInput,
): z.infer<typeof PostInputSchema> {
  const result = PostInputSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

async function uniqueSlug(base: string, existingId?: string): Promise<string> {
  const slug = slugify(base, "post");
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? slug : `${slug}-${i}`;
    const snap = await adminDb()
      .collection("posts")
      .where("slug", "==", candidate)
      .limit(1)
      .get();
    if (snap.empty || snap.docs[0].id === existingId) return candidate;
  }
  return `${slug}-${Date.now().toString(36)}`;
}

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

function orphanPaths(
  prev: ProjectAsset | undefined,
  next: ProjectAsset | undefined,
): string[] {
  if (!prev) return [];
  if (next && next.path === prev.path) return [];
  return [prev.path];
}

// ---------- create ----------

export async function submitPost(input: PostFormInput): Promise<string> {
  const user = await requireUser();
  const parsed = parsePostInput(input);
  const now = Timestamp.now();
  const slug = await uniqueSlug(parsed.title);

  await adminDb().collection("posts").add({
    slug,
    title: parsed.title,
    excerpt: parsed.excerpt,
    body: parsed.body,
    coverImage: parsed.coverImage,
    tags: parsed.tags,
    authorUid: user.uid,
    authorName: user.displayName,
    authorPhotoURL: user.photoURL,
    status: parsed.intent as PostStatus,
    reviewerUid: null,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  if (parsed.intent === "pending") {
    await enqueueAdminNewPostNotification({
      postId: slug,
      title: parsed.title,
      authorName: user.displayName,
      authorEmail: user.email,
    });
  }

  revalidatePath("/blog");
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
  redirect("/my/posts");
}

// ---------- update (owner) ----------

export async function updateMyPost(
  postId: string,
  input: PostFormInput,
): Promise<void> {
  const user = await requireUser();
  const parsed = parsePostInput(input);
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as PostDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    throw new Error("FORBIDDEN");
  }

  const orphans = orphanPaths(cur.coverImage, parsed.coverImage);

  // Non-admin author edits always go back to pending for re-review.
  // Admin edits preserve the current status (admin uses publishPost /
  // decidePost separately for state transitions).
  const nextStatus: PostStatus = user.isAdmin
    ? cur.status
    : (parsed.intent as PostStatus);

  await ref.update({
    title: parsed.title,
    excerpt: parsed.excerpt,
    body: parsed.body,
    coverImage: parsed.coverImage ?? FieldValue.delete(),
    tags: parsed.tags,
    status: nextStatus,
    ...(nextStatus === "pending" ? { submittedAt: Timestamp.now() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (orphans.length > 0) await deleteStoragePaths(orphans);

  revalidatePath("/blog");
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
}

// ---------- delete (owner) ----------

export async function deleteMyPost(postId: string): Promise<void> {
  const user = await requireUser();
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as PostDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    throw new Error("FORBIDDEN");
  }

  const paths: string[] = [];
  if (cur.coverImage) paths.push(cur.coverImage.path);

  await ref.delete();
  if (paths.length > 0) await deleteStoragePaths(paths);

  revalidatePath("/blog");
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
}

// ---------- admin shortcuts ----------

export async function publishPost(postId: string): Promise<void> {
  const admin = await requireAdmin();
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as PostDoc;

  const isFirstPublish = cur.status !== "published";
  await ref.update({
    status: "published" as const,
    reviewerUid: admin.uid,
    ...(isFirstPublish ? { publishedAt: Timestamp.now() } : {}),
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Notify author the first time it goes live.
  if (isFirstPublish && cur.authorUid) {
    const ownerSnap = await adminDb()
      .collection("users")
      .doc(cur.authorUid)
      .get();
    const ownerEmail = ownerSnap.exists
      ? (ownerSnap.data()?.email as string)
      : null;
    if (ownerEmail) {
      await enqueuePostDecisionNotification({
        to: ownerEmail,
        title: cur.title,
        decision: "published",
      });
    }
  }

  revalidatePath("/blog");
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/admin/posts");
}
