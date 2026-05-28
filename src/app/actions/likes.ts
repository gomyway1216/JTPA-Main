"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type { CommentParentType, GuideDoc, PostDoc } from "@/lib/types";

function parentCollection(parentType: CommentParentType): string {
  return parentType === "post" ? "posts" : "guides";
}

function parentRoutePrefix(parentType: CommentParentType): string {
  return parentType === "post" ? "/blog" : "/guide";
}

const RecordSchema = z.object({
  parentType: z.enum(["post", "guide"]),
  parentId: z.string().min(1),
});

const CommentSchema = z.object({
  parentType: z.enum(["post", "guide"]),
  parentId: z.string().min(1),
  commentId: z.string().min(1),
});

export type LikeRecordInput = z.input<typeof RecordSchema>;
export type LikeCommentInput = z.input<typeof CommentSchema>;

export interface LikeResult {
  liked: boolean;
  count: number;
}

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

/**
 * Toggle the current user's like on a post or guide. Returns the resulting
 * state (liked + new denormalized count) so the optimistic UI can
 * reconcile with reality if e.g. another client liked at the same time.
 *
 * The like doc itself is `{parent}/{id}/likes/{uid}` — existence == liked.
 * Wrapping the read+write in a transaction keeps the `likeCount` counter
 * coherent under concurrent flips from the same user across tabs.
 */
export async function toggleLikeRecord(
  input: LikeRecordInput,
): Promise<LikeResult> {
  const user = await requireUser();
  const parsed = readableParse(RecordSchema, input);

  const parentRef = adminDb()
    .collection(parentCollection(parsed.parentType))
    .doc(parsed.parentId);
  const likeRef = parentRef.collection("likes").doc(user.uid);

  const result = await adminDb().runTransaction(async (tx) => {
    const [likeSnap, parentSnap] = await Promise.all([
      tx.get(likeRef),
      tx.get(parentRef),
    ]);
    if (!parentSnap.exists) throw new Error("NOT_FOUND");
    const parent = parentSnap.data() as PostDoc | GuideDoc;
    // Only allow likes on publicly-visible records. Mirrors the comment
    // gate; otherwise drafts/rejected items could accrue likes that
    // would surface if they're later published.
    if (parent.status !== "published") {
      throw new Error("公開済みのコンテンツのみにいいねできます");
    }
    const wasLiked = likeSnap.exists;
    if (wasLiked) {
      tx.delete(likeRef);
      tx.update(parentRef, { likeCount: FieldValue.increment(-1) });
    } else {
      tx.set(likeRef, { createdAt: Timestamp.now() });
      tx.update(parentRef, { likeCount: FieldValue.increment(1) });
    }
    const prevCount = (parent.likeCount as number | undefined) ?? 0;
    return {
      liked: !wasLiked,
      count: wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1,
      slug: parent.slug,
    };
  });

  revalidatePath(`${parentRoutePrefix(parsed.parentType)}/${result.slug}`);
  return { liked: result.liked, count: result.count };
}

/**
 * Toggle the current user's like on a comment. Same transaction shape as
 * the record-level variant, plus a verification step that the comment
 * actually exists under the claimed parent.
 */
export async function toggleLikeComment(
  input: LikeCommentInput,
): Promise<LikeResult> {
  const user = await requireUser();
  const parsed = readableParse(CommentSchema, input);

  const parentRef = adminDb()
    .collection(parentCollection(parsed.parentType))
    .doc(parsed.parentId);
  const commentRef = parentRef.collection("comments").doc(parsed.commentId);
  const likeRef = commentRef.collection("likes").doc(user.uid);

  const result = await adminDb().runTransaction(async (tx) => {
    const [likeSnap, commentSnap, parentSnap] = await Promise.all([
      tx.get(likeRef),
      tx.get(commentRef),
      tx.get(parentRef),
    ]);
    if (!parentSnap.exists || !commentSnap.exists) {
      throw new Error("NOT_FOUND");
    }
    const parent = parentSnap.data() as PostDoc | GuideDoc;
    // Defense in depth: if the parent has been unpublished while the
    // comment is still visible to the author, refuse new likes. Existing
    // likes are left in place — flipping the parent's status back to
    // published shouldn't lose them.
    if (parent.status !== "published") {
      throw new Error("公開済みのコンテンツのみにいいねできます");
    }
    const wasLiked = likeSnap.exists;
    if (wasLiked) {
      tx.delete(likeRef);
      tx.update(commentRef, { likeCount: FieldValue.increment(-1) });
    } else {
      tx.set(likeRef, { createdAt: Timestamp.now() });
      tx.update(commentRef, { likeCount: FieldValue.increment(1) });
    }
    const cur = commentSnap.data();
    const prevCount = (cur?.likeCount as number | undefined) ?? 0;
    return {
      liked: !wasLiked,
      count: wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1,
      slug: parent.slug,
    };
  });

  revalidatePath(`${parentRoutePrefix(parsed.parentType)}/${result.slug}`);
  return { liked: result.liked, count: result.count };
}
