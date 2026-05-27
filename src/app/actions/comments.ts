"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { plainify } from "@/lib/data/serialize";
import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type { PostCommentDoc, PostDoc } from "@/lib/types";

// Note: the action signature no longer takes a `postSlug`. The slug is the
// canonical key used to invalidate the public detail route, and trusting a
// client-provided slug would let any caller force `revalidatePath("/blog/...")`
// for arbitrary routes. We look it up from the post doc instead.
const PostCommentSchema = z.object({
  postId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

const DeleteCommentSchema = z.object({
  postId: z.string().min(1),
  commentId: z.string().min(1),
});

export type PostCommentInput = z.input<typeof PostCommentSchema>;
export type DeleteCommentInput = z.input<typeof DeleteCommentSchema>;

function readableParse<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

export async function postComment(
  input: PostCommentInput,
): Promise<PostCommentDoc> {
  const user = await requireUser();
  const parsed = readableParse(PostCommentSchema, input);

  // Confirm the parent post is published before accepting comments. The
  // Firestore rules enforce the same on direct client writes, but this
  // path goes through the Admin SDK (which bypasses rules), so the
  // server has to re-check.
  const postRef = adminDb().collection("posts").doc(parsed.postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new Error("NOT_FOUND");
  const post = postSnap.data() as PostDoc;
  if (post.status !== "published") {
    throw new Error("コメントは公開済みの記事にのみ投稿できます");
  }

  const now = Timestamp.now();
  const ref = postRef.collection("comments").doc();
  const doc: Omit<PostCommentDoc, "id"> = {
    postId: parsed.postId,
    authorUid: user.uid,
    authorName: user.displayName,
    authorPhotoURL: user.photoURL,
    body: parsed.body,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  // Touch the parent post so a future denormalized commentCount /
  // last-activity field gets coherent cache invalidation. Mirrors the
  // touch in deleteComment.
  await postRef.update({ updatedAt: FieldValue.serverTimestamp() });

  // Use the canonical slug from Firestore, not anything the caller sent.
  revalidatePath(`/blog/${post.slug}`);
  // Plainify before returning across the Server → Client boundary; the
  // Timestamp objects on the freshly built doc would otherwise trigger
  // the "Only plain objects can be passed to Client Components" error
  // (same gotcha PR #8 fixed for submitRsvp).
  return plainify({ ...doc, id: ref.id });
}

export async function deleteComment(
  args: DeleteCommentInput,
): Promise<void> {
  const user = await requireUser();
  const parsed = readableParse(DeleteCommentSchema, args);

  const postRef = adminDb().collection("posts").doc(parsed.postId);
  const ref = postRef.collection("comments").doc(parsed.commentId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as PostCommentDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    throw new Error("FORBIDDEN");
  }
  await ref.delete();
  // Touch the parent post so any future denormalized commentCount stays
  // fresh on cache invalidation, and read its canonical slug for the
  // revalidate call (same reason as postComment: don't trust caller for
  // the route path).
  const postSnap = await postRef.get();
  await postRef.update({ updatedAt: FieldValue.serverTimestamp() });
  if (postSnap.exists) {
    const post = postSnap.data() as PostDoc;
    revalidatePath(`/blog/${post.slug}`);
  }
}
