"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { plainify } from "@/lib/data/serialize";
import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type { PostCommentDoc, PostDoc } from "@/lib/types";

const PostCommentSchema = z.object({
  postId: z.string().min(1),
  postSlug: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
});

export type PostCommentInput = z.input<typeof PostCommentSchema>;

function parse(input: PostCommentInput): z.infer<typeof PostCommentSchema> {
  const result = PostCommentSchema.safeParse(input);
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
  const parsed = parse(input);

  // Confirm the parent post is published before accepting comments. The
  // Firestore rules enforce the same on direct client writes, but this
  // path goes through the Admin SDK (which bypasses rules), so the
  // server has to re-check.
  const postRef = adminDb().collection("posts").doc(parsed.postId);
  const postSnap = await postRef.get();
  if (!postSnap.exists) throw new Error("POST_NOT_FOUND");
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

  revalidatePath(`/blog/${parsed.postSlug}`);
  // Plainify before returning across the Server → Client boundary; the
  // Timestamp objects on the freshly built doc would otherwise trigger
  // the "Only plain objects can be passed to Client Components" error
  // (same gotcha PR #8 fixed for submitRsvp).
  return plainify({ ...doc, id: ref.id });
}

export async function deleteComment(args: {
  postId: string;
  postSlug: string;
  commentId: string;
}): Promise<void> {
  const user = await requireUser();
  const ref = adminDb()
    .collection("posts")
    .doc(args.postId)
    .collection("comments")
    .doc(args.commentId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as PostCommentDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    throw new Error("FORBIDDEN");
  }
  await ref.delete();
  // Mirror the touch pattern used for events/projects so any future
  // denormalized commentCount stays fresh on cache invalidation.
  await adminDb()
    .collection("posts")
    .doc(args.postId)
    .update({ updatedAt: FieldValue.serverTimestamp() });
  revalidatePath(`/blog/${args.postSlug}`);
}
