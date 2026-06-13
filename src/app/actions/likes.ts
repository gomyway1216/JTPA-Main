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
import { enqueueLikeNotification } from "@/lib/notifications";
import type {
  CommentDoc,
  GuideDoc,
  PollDoc,
  PostDoc,
  ProjectDoc,
  QaDoc,
} from "@/lib/types";
import { truncate } from "@/lib/utils";

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

type ParentDoc = PostDoc | GuideDoc | QaDoc | ProjectDoc | PollDoc;
type LikeNotificationPayload = Parameters<typeof enqueueLikeNotification>[0];

async function parseOrError<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; error: string }> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: await inputError(result.error.issues) };
}

function parentAuthorUid(
  parentType: LikeRecordInput["parentType"],
  data: ParentDoc,
): string | null {
  switch (parentType) {
    case "project":
      return (data as ProjectDoc).ownerUid ?? null;
    case "guide":
      return (
        (data as GuideDoc).authorUid ?? (data as GuideDoc).createdBy?.uid ?? null
      );
    case "post":
      return (data as PostDoc).authorUid ?? null;
    case "qa":
      return (data as QaDoc).authorUid ?? null;
    case "poll":
      return (data as PollDoc).authorUid ?? null;
  }
}

function parentTitle(data: ParentDoc): string {
  return typeof data.title === "string" ? data.title : "";
}

async function enqueueLikeNotificationBestEffort(
  notification: LikeNotificationPayload | null,
) {
  if (!notification) return;
  await enqueueLikeNotification(notification).catch((err) => {
    console.error("Failed to enqueue like notification:", err);
  });
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
  const now = Timestamp.now();

  const result = await adminDb().runTransaction<
    | { ok: false; error: string }
    | {
        ok: true;
        liked: boolean;
        count: number;
        slug: string;
        notification: LikeNotificationPayload | null;
      }
  >(async (tx) => {
    const [likeSnap, parentSnap] = await Promise.all([
      tx.get(likeRef),
      tx.get(parentRef),
    ]);
    if (!parentSnap.exists) {
      return { ok: false as const, error: await actionError("likeTargetNotFound") };
    }
    const parent = parentSnap.data() as ParentDoc;
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
      tx.set(likeRef, { createdAt: now });
    }
    tx.update(parentRef, { likeCount: newCount });
    const recipientUid = !wasLiked
      ? parentAuthorUid(parsed.parentType, parent)
      : null;
    return {
      ok: true as const,
      liked: !wasLiked,
      count: newCount,
      slug: parent.slug,
      notification:
        recipientUid && recipientUid !== user.uid
          ? {
              recipientUid,
              reason: "like_on_content",
              actorUid: user.uid,
              actorName: user.displayName,
              actorPhotoURL: user.photoURL,
              parentType: parsed.parentType,
              parentId: parsed.parentId,
              parentTitle: parentTitle(parent),
              parentSlug: parent.slug,
              createdAt: now,
            }
          : null,
    };
  });

  if (!result.ok) return result;
  await enqueueLikeNotificationBestEffort(result.notification);
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
  const now = Timestamp.now();

  const result = await adminDb().runTransaction<
    | { ok: false; error: string }
    | {
        ok: true;
        liked: boolean;
        count: number;
        slug: string;
        notification: LikeNotificationPayload | null;
      }
  >(async (tx) => {
    const [likeSnap, commentSnap, parentSnap] = await Promise.all([
      tx.get(likeRef),
      tx.get(commentRef),
      tx.get(parentRef),
    ]);
    if (!parentSnap.exists || !commentSnap.exists) {
      return { ok: false as const, error: await actionError("likeTargetNotFound") };
    }
    const parent = parentSnap.data() as ParentDoc;
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
    const cur = commentSnap.data() as Partial<CommentDoc> | undefined;
    const prevCount = (cur?.likeCount as number | undefined) ?? 0;
    const newCount = wasLiked ? Math.max(0, prevCount - 1) : prevCount + 1;
    if (wasLiked) {
      tx.delete(likeRef);
    } else {
      tx.set(likeRef, { createdAt: now });
    }
    tx.update(commentRef, { likeCount: newCount });
    const recipientUid = !wasLiked ? (cur?.authorUid ?? null) : null;
    const commentPreview =
      typeof cur?.body === "string"
        ? truncate(cur.body.replace(/\s+/g, " "), 160)
        : undefined;
    return {
      ok: true as const,
      liked: !wasLiked,
      count: newCount,
      slug: parent.slug,
      notification:
        recipientUid && recipientUid !== user.uid && !cur?.deletedAt
          ? {
              recipientUid,
              reason: "like_on_comment",
              actorUid: user.uid,
              actorName: user.displayName,
              actorPhotoURL: user.photoURL,
              parentType: parsed.parentType,
              parentId: parsed.parentId,
              parentTitle: parentTitle(parent),
              parentSlug: parent.slug,
              commentId: parsed.commentId,
              commentPreview,
              createdAt: now,
            }
          : null,
    };
  });

  if (!result.ok) return result;
  await enqueueLikeNotificationBestEffort(result.notification);
  revalidatePath(`${parentRoutePrefix(parsed.parentType)}/${result.slug}`);
  return { ok: true, result: { liked: result.liked, count: result.count } };
}
