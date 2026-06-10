import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { parentCollection } from "@/lib/comments-parent";
import { adminDb } from "@/lib/firebase/admin";
import { decodePageCursor, slicePage } from "@/lib/data/page-cursor";
import { plainify } from "@/lib/data/serialize";
import type { CommentDoc, CommentParentType } from "@/lib/types";

const COMMENT_PARENT_TYPES: readonly CommentParentType[] = [
  "post",
  "guide",
  "qa",
  "project",
  "poll",
];

function isCommentParentType(value: unknown): value is CommentParentType {
  return (
    typeof value === "string" &&
    (COMMENT_PARENT_TYPES as readonly string[]).includes(value)
  );
}

function fromSnap(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
  parentType: CommentParentType,
  parentId: string,
): CommentDoc {
  const data = doc.data() as Omit<CommentDoc, "id">;
  return plainify({
    // Defaults for fields older docs (created before this PR) may not have.
    parentCommentId: null,
    likeCount: 0,
    ...data,
    // The denormalized parent fields are sometimes absent on legacy comments
    // that were written before the schema added them. Re-derive them from
    // the path the caller passed so the returned doc is always well-formed
    // regardless of what's actually on disk.
    parentType,
    parentId,
    id: doc.id,
  });
}

export const COMMENTS_PAGE_SIZE = 50;

export type CommentsPage = {
  comments: CommentDoc[];
  // Opaque cursor for fetching the page after this one (pass it back as
  // `opts.cursor`); null when this page reached the end of the thread.
  nextCursor: string | null;
};

/**
 * Cursor-paged listing of a parent's comment thread, oldest first.
 *
 * Pages walk the flat subcollection in (createdAt asc, doc id asc)
 * order. Ascending order is what makes paginating the *flat* list safe
 * for threading: a reply can only be written against a comment that
 * already exists, so a reply's parent always sorts before the reply and
 * the client-side thread builder never sees a reply orphaned merely
 * because its parent is on a later page.
 */
export async function listComments(
  parentType: CommentParentType,
  parentId: string,
  opts: { cursor?: string | null; pageSize?: number } = {},
): Promise<CommentsPage> {
  const { cursor = null, pageSize = COMMENTS_PAGE_SIZE } = opts;
  let query = adminDb()
    .collection(parentCollection(parentType))
    .doc(parentId)
    .collection("comments")
    .orderBy("createdAt", "asc")
    // Explicit doc-id tiebreak so the cursor stays total-ordered when two
    // comments share a createdAt. This matches the implicit __name__
    // ordering Firestore appends to every query anyway (same direction as
    // the last orderBy), so no composite index is needed.
    .orderBy(FieldPath.documentId(), "asc")
    // Overfetch by one so we know whether another page exists without a
    // separate count() read; `slicePage` drops the extra doc.
    .limit(pageSize + 1);
  // A malformed cursor (tampered or stale client value) decodes to null
  // and falls back to the first page rather than throwing.
  const decoded = cursor ? decodePageCursor(cursor) : null;
  if (decoded) query = query.startAfter(decoded.createdAt, decoded.id);
  const snap = await query.get();
  const { pageDocs, nextCursor } = slicePage(snap.docs, pageSize);
  return {
    comments: pageDocs.map((d) => fromSnap(d, parentType, parentId)),
    nextCursor,
  };
}

// Returns the user's comments that have at least one like, most-liked
// first, capped at `limit`. Soft-deleted comments are excluded so users
// don't see "likes on a comment I deleted." Uses a collection-group query
// across all four parent types, so the matching Firestore composite index
// (authorUid ASC, likeCount DESC) is required — see `firestore.indexes.json`.
export async function listLikedCommentsByAuthor(
  authorUid: string,
  limit = 50,
): Promise<CommentDoc[]> {
  // `likeCount > 0` is pushed into Firestore so the `limit` budget isn't
  // burned on unliked comments. The composite index has `likeCount` as
  // the second (and only inequality-eligible) ordered field, so this is
  // satisfied by the same index we already require for the orderBy.
  const snap = await adminDb()
    .collectionGroup("comments")
    .where("authorUid", "==", authorUid)
    .where("likeCount", ">", 0)
    .orderBy("likeCount", "desc")
    .limit(limit)
    .get();
  const docs: CommentDoc[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Omit<CommentDoc, "id">;
    if (data.deletedAt) continue;
    // The collection-group query doesn't know which parent path a doc came
    // from, so re-derive parentType/parentId from the ref ancestry. This
    // also defends against legacy docs that lack the denormalized fields.
    const commentsCol = d.ref.parent; // /<parents>/<parentId>/comments
    const parentDoc = commentsCol.parent; // /<parents>/<parentId>
    const parentCol = parentDoc?.parent?.id; // "posts" | "guides" | ...
    const parentId = parentDoc?.id;
    if (!parentCol || !parentId) continue;
    const parentType = parentColToType(parentCol);
    if (!parentType) continue;
    docs.push(
      plainify({
        parentCommentId: null,
        likeCount: 0,
        ...data,
        parentType,
        parentId,
        id: d.id,
      }),
    );
  }
  return docs;
}

function parentColToType(col: string): CommentParentType | null {
  switch (col) {
    case "posts":
      return "post";
    case "guides":
      return "guide";
    case "qa":
      return "qa";
    case "projects":
      return "project";
    case "polls":
      return "poll";
    default:
      return null;
  }
}

export type CommentParentMeta = {
  parentType: CommentParentType;
  parentId: string;
  title: string;
  slug: string;
};

// Batch-fetch (title, slug) for the parents of a list of comments. Returns
// a Map keyed by `${parentType}:${parentId}`. Parents that no longer exist
// are simply absent — callers should handle that as "skip / deleted."
export async function fetchCommentParentMetas(
  parents: { parentType: CommentParentType; parentId: string }[],
): Promise<Map<string, CommentParentMeta>> {
  // Dedupe by (parentType, parentId): if the same blog post has three
  // liked comments on it, we only need to read that doc once.
  const uniqueParents = Array.from(
    new Map(
      parents.map((p) => [`${p.parentType}:${p.parentId}`, p] as const),
    ).values(),
  );
  const out = new Map<string, CommentParentMeta>();
  if (uniqueParents.length === 0) return out;
  const refs = uniqueParents.map(({ parentType, parentId }) =>
    adminDb().collection(parentCollection(parentType)).doc(parentId),
  );
  const snaps = await adminDb().getAll(...refs);
  snaps.forEach((s, i) => {
    if (!s.exists) return;
    const data = s.data() as { title?: string; slug?: string };
    if (!data.title || !data.slug) return;
    const { parentType, parentId } = uniqueParents[i];
    if (!isCommentParentType(parentType)) return;
    out.set(`${parentType}:${parentId}`, {
      parentType,
      parentId,
      title: data.title,
      slug: data.slug,
    });
  });
  return out;
}
