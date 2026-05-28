import "server-only";

import { parentCollection } from "@/lib/comments-parent";
import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type {
  CommentDoc,
  CommentParentType,
  PostCommentDoc,
} from "@/lib/types";

const COMMENT_PARENT_TYPES: readonly CommentParentType[] = [
  "post",
  "guide",
  "qa",
  "project",
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

// Hard cap as a runaway-cost / spam guard. Pagination can be added later
// when a real thread approaches this number; until then a small per-parent
// page is fine for both UX and Firestore read budget.
const COMMENTS_PER_PAGE = 500;

export async function listComments(
  parentType: CommentParentType,
  parentId: string,
): Promise<CommentDoc[]> {
  const snap = await adminDb()
    .collection(parentCollection(parentType))
    .doc(parentId)
    .collection("comments")
    .orderBy("createdAt", "asc")
    .limit(COMMENTS_PER_PAGE)
    .get();
  return snap.docs.map((d) => fromSnap(d, parentType, parentId));
}

// Back-compat for callers that haven't migrated to listComments yet. Kept
// thin so the migration to listComments stays one find-and-replace away.
export async function listPostComments(
  postId: string,
): Promise<PostCommentDoc[]> {
  return listComments("post", postId);
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
  const snap = await adminDb()
    .collectionGroup("comments")
    .where("authorUid", "==", authorUid)
    .orderBy("likeCount", "desc")
    .limit(limit)
    .get();
  const docs: CommentDoc[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Omit<CommentDoc, "id">;
    if (data.deletedAt) continue;
    if (!data.likeCount || data.likeCount <= 0) continue;
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
  const refs = parents.map(({ parentType, parentId }) =>
    adminDb().collection(parentCollection(parentType)).doc(parentId),
  );
  const out = new Map<string, CommentParentMeta>();
  if (refs.length === 0) return out;
  const snaps = await adminDb().getAll(...refs);
  snaps.forEach((s, i) => {
    if (!s.exists) return;
    const data = s.data() as { title?: string; slug?: string };
    if (!data.title || !data.slug) return;
    const { parentType, parentId } = parents[i];
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
