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

export async function submitPost(input: PostFormInput): Promise<void> {
  const user = await requireUser();
  const parsed = parsePostInput(input);
  const now = Timestamp.now();
  const slug = await uniqueSlug(parsed.title);

  // Capture the doc id from `.add()` — admin tooling and future moderation
  // actions look posts up by document id, not by slug, so the notification
  // metadata needs the id (not the slug).
  const ref = await adminDb().collection("posts").add({
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
      postId: ref.id,
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

  // Non-admin author edits land in the author's chosen intent (draft or
  // pending). Authoring intent → status:
  //   - "draft"   : save without resubmitting for review
  //   - "pending" : (re)submit for admin review
  // The author can never directly set published/rejected/archived; admins
  // handle those transitions via publishPost (or future moderation
  // actions). Firestore rules enforce the same constraint client-side.
  // Admin edits preserve the current status — admins use publishPost
  // explicitly for state transitions.
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
  redirect("/my/posts");
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
  // Also revalidate the now-gone detail route so a cached 200 from earlier
  // doesn't keep serving the deleted post.
  revalidatePath(`/blog/${cur.slug}`);
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

  // Check the timestamp directly so re-publishing a post that was edited
  // back to pending doesn't re-trigger "first publish" handling
  // (publishedAt overwrite + duplicate author notification).
  const isFirstPublish = !cur.publishedAt;
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

export async function decidePost(
  postId: string,
  decision: "published" | "rejected",
  note?: string,
): Promise<void> {
  const admin = await requireAdmin();
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as PostDoc;

  // Same first-publish detection as publishPost — anchored on the actual
  // publishedAt timestamp so re-publish after edit doesn't overwrite it
  // or re-notify.
  const isFirstPublish = decision === "published" && !cur.publishedAt;
  const isRejection = decision === "rejected";
  await ref.update({
    status: decision,
    reviewerUid: admin.uid,
    // The note is documented (and labeled in the UI) as the rejection
    // reason. Clear it on approval so a previous rejection's note doesn't
    // accidentally persist when the same post comes back through review
    // and gets approved.
    reviewNote: isRejection ? (note ?? "") : "",
    ...(isFirstPublish ? { publishedAt: Timestamp.now() } : {}),
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Notify the author on first publish OR any rejection. The note only
  // travels with rejection mails to match the UI placeholder + docs.
  const notifyOnDecision = isRejection || isFirstPublish;
  if (notifyOnDecision && cur.authorUid) {
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
        decision,
        note: isRejection ? note : undefined,
      });
    }
  }

  revalidatePath("/blog");
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
}

// Not wired into the UI yet — kept ready for the published-list "アーカイブ"
// button (planned follow-up) so older posts can be retired without losing
// the doc (vs deleteMyPost which removes it entirely).
export async function archivePost(postId: string): Promise<void> {
  await requireAdmin();
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as PostDoc;
  await ref.update({
    status: "archived" as const,
    updatedAt: FieldValue.serverTimestamp(),
  });
  revalidatePath("/blog");
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/admin/posts");
}
