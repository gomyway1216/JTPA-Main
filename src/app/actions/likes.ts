"use server";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireUser } from "@/lib/auth/session";
import {
  isParentPubliclyVisible,
  parentCollection,
  parentRoutePrefix,
} from "@/lib/comments-parent";
import { adminDb } from "@/lib/firebase/admin";
import { actionError, inputError } from "@/lib/i18n/action-errors";
import type {
  GuideDoc,
  PollDoc,
  PostDoc,
  ProjectDoc,
  QaDoc,
} from "@/lib/types";

const RecordSchema = z.object({
  parentType: z.enum(["post", "guide", "qa", "project", "poll"]),
  parentId: z.string().min(1),
});

const CommentSchema = z.object({
  parentType: z.enum(["post", "guide", "qa", "project", "poll"]),
  parentId: z.string().min(1),
  commentId: z.string().min(1),
});

export type LikeRecordInput = z.input<typeof RecordSchema>;
export type LikeCommentInput = z.input<typeof CommentSchema>;

export interface LikeResult {
  liked: boolean;
  count: number;
}

async function readableParse<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): Promise<z.infer<T>> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(await inputError(result.error.issues));
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
  const parsed = await readableParse(RecordSchema, input);

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
    const parent = parentSnap.data() as PostDoc | GuideDoc | QaDoc | ProjectDoc | PollDoc;
    // Only allow likes on publicly-visible records. Mirrors the comment
    // gate; otherwise drafts/rejected items could accrue likes that
    // would surface if they're later published.
    if (!isParentPubliclyVisible(parsed.parentType, parent)) {
      throw new Error(await actionError("publishedOnlyLike"));
    }
    const wasLiked = likeSnap.exists;
    // Compute the new count in memory and write it directly. The original
    // implementation used `FieldValue.increment(-1)`, but on a legacy doc
    // without an explicit `likeCount` field that drives the value to `-1`
    // — meanwhile the UI clamps to 0, so the DB and the UI desync. The
    // transaction already has the previous value in hand; using it
    // sidesteps the issue and keeps DB / response identical.
    const prevCount = (parent.likeCount as number | undefined) ?? 0;
    const newCount = wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1;
    if (wasLiked) {
      tx.delete(likeRef);
    } else {
      tx.set(likeRef, { createdAt: Timestamp.now() });
    }
    tx.update(parentRef, { likeCount: newCount });
    return {
      liked: !wasLiked,
      count: newCount,
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
  const parsed = await readableParse(CommentSchema, input);

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
    const parent = parentSnap.data() as PostDoc | GuideDoc | QaDoc | ProjectDoc | PollDoc;
    // Defense in depth: if the parent has been unpublished while the
    // comment is still visible to the author, refuse new likes. Existing
    // likes are left in place — flipping the parent's status back to
    // published shouldn't lose them.
    if (!isParentPubliclyVisible(parsed.parentType, parent)) {
      throw new Error(await actionError("publishedOnlyLike"));
    }
    const wasLiked = likeSnap.exists;
    // In-memory compute for the same reason as toggleLikeRecord — keeps
    // DB and UI in sync on legacy comments without a `likeCount` field.
    const cur = commentSnap.data();
    const prevCount = (cur?.likeCount as number | undefined) ?? 0;
    const newCount = wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1;
    if (wasLiked) {
      tx.delete(likeRef);
    } else {
      tx.set(likeRef, { createdAt: Timestamp.now() });
    }
    tx.update(commentRef, { likeCount: newCount });
    return {
      liked: !wasLiked,
      count: newCount,
      slug: parent.slug,
    };
  });

  revalidatePath(`${parentRoutePrefix(parsed.parentType)}/${result.slug}`);
  return { liked: result.liked, count: result.count };
}
