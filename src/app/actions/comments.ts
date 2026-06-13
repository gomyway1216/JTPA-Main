"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { plainify } from "@/lib/data/serialize";
import { getSessionUser, requireUser } from "@/lib/auth/session";
import {
  isParentPubliclyVisible,
  parentCollection,
  parentRoutePrefix,
} from "@/lib/comments-parent";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent } from "@/lib/data/likes";
import { getPublicProfilesByUids, type PublicProfile } from "@/lib/data/users";
import { adminDb } from "@/lib/firebase/admin";
import { actionError, inputError } from "@/lib/i18n/action-errors";
import {
  enqueueCommentNotifications,
  type CommentNotificationRecipient,
} from "@/lib/notifications";
import type {
  CommentDoc,
  CommentParentType,
  GuideDoc,
  PollDoc,
  PostDoc,
  ProjectDoc,
  QaDoc,
  SessionUser,
} from "@/lib/types";
import { truncate } from "@/lib/utils";

const CommentSchema = z.object({
  parentType: z.enum(["post", "guide", "qa", "project", "poll"]),
  parentId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
  // Top-level comment when omitted/null. When provided, must reference
  // an existing comment under the same parent — verified server-side
  // before the write goes through.
  parentCommentId: z.string().min(1).optional().nullable(),
});

const DeleteSchema = z.object({
  parentType: z.enum(["post", "guide", "qa", "project", "poll"]),
  parentId: z.string().min(1),
  commentId: z.string().min(1),
  // Admin-only: actually remove the doc instead of soft-deleting.
  hard: z.boolean().optional(),
});

const LoadMoreSchema = z.object({
  parentType: z.enum(["post", "guide", "qa", "project", "poll"]),
  parentId: z.string().min(1),
  // Opaque page cursor from a previous listComments page. Required: the
  // first page always arrives server-rendered, so this action only ever
  // continues an existing listing.
  cursor: z.string().min(1),
});

export type CommentInput = z.input<typeof CommentSchema>;
export type DeleteCommentInput = z.input<typeof DeleteSchema>;
export type LoadMoreCommentsInput = z.input<typeof LoadMoreSchema>;

// Results returned to the client. Returning the error (rather than
// throwing it) keeps the real message reachable — Next masks thrown
// Server Action errors as a generic digest in production.
export type PostCommentResult =
  | { ok: true; comment: CommentDoc }
  | { ok: false; error: string };
export type DeleteCommentResult =
  | { ok: true; comment: CommentDoc | null }
  | { ok: false; error: string };
export type LoadMoreCommentsResult =
  | {
      ok: true;
      comments: CommentDoc[];
      nextCursor: string | null;
      // Like-state + author profiles for the returned comments, so the
      // client can extend the maps it was seeded with for page one
      // (LikeButton initial state, AuthorBadge rendering).
      likedKeys: string[];
      profiles: Record<string, PublicProfile>;
    }
  | { ok: false; error: string };

function parentAuthorUid(
  parentType: CommentParentType,
  data: PostDoc | GuideDoc | QaDoc | ProjectDoc | PollDoc,
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

function commentNotificationRecipients(opts: {
  actorUid: string;
  parentOwnerUid: string | null;
  parentComment: CommentDoc | null;
}): CommentNotificationRecipient[] {
  const byUid = new Map<string, CommentNotificationRecipient>();
  if (opts.parentOwnerUid && opts.parentOwnerUid !== opts.actorUid) {
    byUid.set(opts.parentOwnerUid, {
      uid: opts.parentOwnerUid,
      reason: "comment_on_content",
    });
  }
  const replyUid = opts.parentComment?.authorUid;
  if (replyUid && replyUid !== opts.actorUid) {
    byUid.set(replyUid, { uid: replyUid, reason: "reply_to_comment" });
  }
  return [...byUid.values()];
}

async function parseOrError<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; error: string }> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: await inputError(result.error.issues) };
}

// ---------- post / list ----------

export async function postComment(
  input: CommentInput,
): Promise<PostCommentResult> {
  const user = await requireUser();
  const pr = await parseOrError(CommentSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

  // Confirm the parent is published before accepting comments. Firestore
  // rules enforce the same on direct client writes, but Server Actions go
  // through the Admin SDK (which bypasses rules), so we re-check.
  const parentRef = adminDb()
    .collection(parentCollection(parsed.parentType))
    .doc(parsed.parentId);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) {
    return { ok: false, error: await actionError("commentParentNotFound") };
  }
  const parentData = parentSnap.data() as PostDoc | GuideDoc | QaDoc | ProjectDoc | PollDoc;
  if (!isParentPubliclyVisible(parsed.parentType, parentData)) {
    return { ok: false, error: await actionError("commentPublishedOnly") };
  }

  let parentComment: CommentDoc | null = null;
  // If this is a reply, validate the parent comment exists AND lives under
  // the same parent. Without this check, a malicious client could submit
  // `parentCommentId` pointing at a comment under a totally different
  // post/guide and our "Re: @author" rendering would silently misattribute.
  if (parsed.parentCommentId) {
    const parentCommentSnap = await parentRef
      .collection("comments")
      .doc(parsed.parentCommentId)
      .get();
    if (!parentCommentSnap.exists) {
      return { ok: false, error: await actionError("replyCommentNotFound") };
    }
    const parentCommentData = parentCommentSnap.data?.() as
      | Omit<CommentDoc, "id">
      | undefined;
    parentComment = parentCommentData
      ? { ...parentCommentData, id: parsed.parentCommentId }
      : null;
  }

  const now = Timestamp.now();
  const ref = parentRef.collection("comments").doc();
  const doc: Omit<CommentDoc, "id"> = {
    parentType: parsed.parentType,
    parentId: parsed.parentId,
    authorUid: user.uid,
    authorName: user.displayName,
    authorPhotoURL: user.photoURL,
    body: parsed.body,
    parentCommentId: parsed.parentCommentId ?? null,
    likeCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  await parentRef.update({ updatedAt: FieldValue.serverTimestamp() });

  const recipients = commentNotificationRecipients({
    actorUid: user.uid,
    parentOwnerUid: parentAuthorUid(parsed.parentType, parentData),
    parentComment,
  });
  if (recipients.length > 0) {
    await enqueueCommentNotifications({
      recipients,
      actorUid: user.uid,
      actorName: user.displayName,
      actorPhotoURL: user.photoURL,
      parentType: parsed.parentType,
      parentId: parsed.parentId,
      parentTitle:
        "title" in parentData && typeof parentData.title === "string"
          ? parentData.title
          : "",
      parentSlug: parentData.slug,
      commentId: ref.id,
      parentCommentId: parsed.parentCommentId ?? null,
      commentPreview: truncate(parsed.body.replace(/\s+/g, " "), 160),
      createdAt: now,
    }).catch((err) => {
      console.error("Failed to enqueue comment notifications:", err);
    });
  }

  // Use the canonical slug from Firestore, not anything the caller sent
  // (slugs in the route are server-validated this way).
  revalidatePath(`${parentRoutePrefix(parsed.parentType)}/${parentData.slug}`);
  return { ok: true, comment: plainify({ ...doc, id: ref.id }) };
}

// Read-path visibility: who may list comments under a parent. Mirrors
// the corresponding detail pages exactly:
//   - published/approved parents are public (anonymous included)
//   - /qa and /poll render unpublished docs for the author and admins
//   - /guide renders unpublished docs for the author, admins, and editors
//   - /blog and /showcase 404 unpublished docs for everyone
// Not a `requireUser` gate — anonymous viewers read comments on public
// parents the same way the server-rendered first page does.
function canReadComments(
  parentType: CommentParentType,
  data: { status: string; authorUid?: string; createdBy?: { uid?: string } },
  user: SessionUser | null,
): boolean {
  if (isParentPubliclyVisible(parentType, data)) return true;
  if (!user) return false;
  switch (parentType) {
    case "post":
    case "project":
      return false;
    case "qa":
    case "poll":
      return user.isAdmin || user.uid === data.authorUid;
    case "guide": {
      // Same owner fallback the guide page uses for legacy docs that
      // predate the `authorUid` field.
      const ownerUid = data.authorUid ?? data.createdBy?.uid;
      return user.isAdmin || user.isEditor || user.uid === ownerUid;
    }
  }
}

// Fetches the next comments page for a thread whose first page was
// server-rendered. Also returns the viewer's like-state and the public
// profiles for the page's authors — the same companion data the pages
// prefetch for page one — so the client can merge them in.
export async function loadMoreComments(
  input: LoadMoreCommentsInput,
): Promise<LoadMoreCommentsResult> {
  const pr = await parseOrError(LoadMoreSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

  // Session + parent doc are independent — fetch together, like the
  // detail pages do.
  const [user, parentSnap] = await Promise.all([
    getSessionUser(),
    adminDb()
      .collection(parentCollection(parsed.parentType))
      .doc(parsed.parentId)
      .get(),
  ]);
  if (!parentSnap.exists) {
    return { ok: false, error: await actionError("commentParentNotFound") };
  }
  const parentData = parentSnap.data() as {
    status: string;
    authorUid?: string;
    createdBy?: { uid?: string };
  };
  if (!canReadComments(parsed.parentType, parentData, user)) {
    // Same response as a missing parent so this action doesn't leak
    // whether an unpublished doc exists — the pages 404 identically.
    return { ok: false, error: await actionError("commentParentNotFound") };
  }

  const { comments, nextCursor } = await listComments(
    parsed.parentType,
    parsed.parentId,
    { cursor: parsed.cursor },
  );
  // An empty page is possible when every doc after the cursor was
  // hard-deleted between page fetches. `nextCursor` still comes from the
  // raw overfetch in `listComments`, so paging keeps advancing correctly;
  // we just skip the companion lookups (which would otherwise do a stray
  // record-like BatchGet for no comments) and return empty companion data.
  if (comments.length === 0) {
    return { ok: true, comments, nextCursor, likedKeys: [], profiles: {} };
  }
  const [likedKeys, profiles] = await Promise.all([
    getMyLikesForParent({
      parentType: parsed.parentType,
      parentId: parsed.parentId,
      commentIds: comments.map((c) => c.id),
      uid: user?.uid ?? null,
    }),
    getPublicProfilesByUids(comments.map((c) => c.authorUid)),
  ]);
  return {
    ok: true,
    comments,
    nextCursor,
    likedKeys: [...likedKeys],
    profiles: Object.fromEntries(profiles),
  };
}

// ---------- delete ----------

// Soft-deletes by default: clears body and stamps `deletedAt` so the UI
// can render a deleted-comment placeholder while keeping the slot in the
// thread (replies stay attached to their parent). Hard delete — actually
// removing the doc — is admin-only.
export async function deleteComment(
  input: DeleteCommentInput,
): Promise<DeleteCommentResult> {
  const user = await requireUser();
  const pr = await parseOrError(DeleteSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

  if (parsed.hard && !user.isAdmin) {
    return { ok: false, error: await actionError("commentHardDeleteAdminOnly") };
  }

  const parentRef = adminDb()
    .collection(parentCollection(parsed.parentType))
    .doc(parsed.parentId);
  const ref = parentRef.collection("comments").doc(parsed.commentId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, comment: null };
  const cur = snap.data() as CommentDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    return { ok: false, error: await actionError("commentDeleteForbidden") };
  }

  let result: CommentDoc | null;
  if (parsed.hard) {
    await ref.delete();
    result = null;
  } else {
    const now = Timestamp.now();
    await ref.update({ body: "", deletedAt: now, updatedAt: now });
    result = plainify({
      ...cur,
      body: "",
      deletedAt: now,
      updatedAt: now,
      id: ref.id,
    });
  }

  // Touch parent so cached pages with denormalized counters invalidate,
  // and pick the slug off the parent for the revalidate path (don't
  // trust caller for the route). Guard against the rare case where the
  // parent itself has already been deleted: calling `.update()` on a
  // missing doc throws NOT_FOUND and would surface as a generic Server
  // Action crash, even though the delete-comment work itself succeeded.
  const parentSnap = await parentRef.get();
  if (parentSnap.exists) {
    await parentRef.update({ updatedAt: FieldValue.serverTimestamp() });
    const parentData = parentSnap.data() as PostDoc | GuideDoc | QaDoc | ProjectDoc | PollDoc;
    revalidatePath(
      `${parentRoutePrefix(parsed.parentType)}/${parentData.slug}`,
    );
  }
  return { ok: true, comment: result };
}

// ---------- legacy aliases ----------
// Keep the old signature available so any caller that still uses
// `postComment({ postId, body })` keeps working until they migrate.
// Removed once all call sites use the parent-typed API.
export type PostCommentInput = {
  postId: string;
  body: string;
  parentCommentId?: string | null;
};
export async function postPostComment(
  input: PostCommentInput,
): Promise<PostCommentResult> {
  return postComment({
    parentType: "post",
    parentId: input.postId,
    body: input.body,
    parentCommentId: input.parentCommentId,
  });
}
