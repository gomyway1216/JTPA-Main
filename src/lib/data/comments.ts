import "server-only";

import { parentCollection } from "@/lib/comments-parent";
import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { CommentDoc, CommentParentType, PostCommentDoc } from "@/lib/types";

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
