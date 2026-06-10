"use server";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath, updateTag } from "next/cache";
import * as z from "zod";

import { requireUser } from "@/lib/auth/session";
import {
  isParentPubliclyVisible,
  parentCollection,
  parentRoutePrefix,
} from "@/lib/comments-parent";
import { likeParentTag } from "@/lib/data/cache-tags";
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

// Returning the error (rather than throwing it) keeps the real message
// reachable — Next masks thrown Server Action errors as a generic digest
// in production.
export type LikeActionResult =
  | { ok: true; result: LikeResult }
  | { ok: false; error: string };

async function parseOrError<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; error: string }> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: await inputError(result.error.issues) };
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
): Promise<LikeActionResult> {
  const user = await requireUser();
  const pr = await parseOrError(RecordSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

  const parentRef = adminDb()
    .collection(parentCollection(parsed.parentType))
    .doc(parsed.parentId);
  const likeRef = parentRef.collection("likes").doc(user.uid);

  const result = await adminDb().runTransaction<
    | { ok: false; error: string }
    | { ok: true; liked: boolean; count: number; slug: string }
  >(async (tx) => {
    const [likeSnap, parentSnap] = await Promise.all([
      tx.get(likeRef),
      tx.get(parentRef),
    ]);
    if (!parentSnap.exists) {
      return { ok: false as const, error: await actionError("likeTargetNotFound") };
    }
    const parent = parentSnap.data() as PostDoc | GuideDoc | QaDoc | ProjectDoc | PollDoc;
    // Only allow likes on publicly-visible records. Mirrors the comment
    // gate; otherwise drafts/rejected items could accrue likes that
    // would surface if they're later published.
    if (!isParentPubliclyVisible(parsed.parentType, parent)) {
      return { ok: false as const, error: await actionError("publishedOnlyLike") };
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
      ok: true as const,
      liked: !wasLiked,
      count: newCount,
      slug: parent.slug,
    };
  });

  if (!result.ok) return result;
  // The toggle bumped `likeCount` on the parent doc, which post/guide/
  // project detail pages serve from the cross-request data cache
  // (src/lib/data/cached.ts). Expire ONLY that entity's tag — likes are
  // the highest-frequency mutation, and the entity tag keeps the
  // expensive cached list queries intact. qa/poll parents aren't cached,
  // so likeParentTag returns null for them.
  const entityTag = likeParentTag(parsed.parentType, result.slug);
  if (entityTag) updateTag(entityTag);
  revalidatePath(`${parentRoutePrefix(parsed.parentType)}/${result.slug}`);
  return { ok: true, result: { liked: result.liked, count: result.count } };
}

/**
 * Toggle the current user's like on a comment. Same transaction shape as
 * the record-level variant, plus a verification step that the comment
 * actually exists under the claimed parent.
 */
export async function toggleLikeComment(
  input: LikeCommentInput,
): Promise<LikeActionResult> {
  const user = await requireUser();
  const pr = await parseOrError(CommentSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

  const parentRef = adminDb()
    .collection(parentCollection(parsed.parentType))
    .doc(parsed.parentId);
  const commentRef = parentRef.collection("comments").doc(parsed.commentId);
  const likeRef = commentRef.collection("likes").doc(user.uid);

  const result = await adminDb().runTransaction<
    | { ok: false; error: string }
    | { ok: true; liked: boolean; count: number; slug: string }
  >(async (tx) => {
    const [likeSnap, commentSnap, parentSnap] = await Promise.all([
      tx.get(likeRef),
      tx.get(commentRef),
      tx.get(parentRef),
    ]);
    if (!parentSnap.exists || !commentSnap.exists) {
      return { ok: false as const, error: await actionError("likeTargetNotFound") };
    }
    const parent = parentSnap.data() as PostDoc | GuideDoc | QaDoc | ProjectDoc | PollDoc;
    // Defense in depth: if the parent has been unpublished while the
    // comment is still visible to the author, refuse new likes. Existing
    // likes are left in place — flipping the parent's status back to
    // published shouldn't lose them.
    if (!isParentPubliclyVisible(parsed.parentType, parent)) {
      return { ok: false as const, error: await actionError("publishedOnlyLike") };
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
      ok: true as const,
      liked: !wasLiked,
      count: newCount,
      slug: parent.slug,
    };
  });

  if (!result.ok) return result;
  revalidatePath(`${parentRoutePrefix(parsed.parentType)}/${result.slug}`);
  return { ok: true, result: { liked: result.liked, count: result.count } };
}
