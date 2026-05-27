import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { PostCommentDoc } from "@/lib/types";

function fromSnap(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): PostCommentDoc {
  const data = doc.data() as Omit<PostCommentDoc, "id">;
  return plainify({ ...data, id: doc.id });
}

// Hard cap as a runaway-cost / spam guard. Pagination can be added later
// when a real thread approaches this number; until then a small per-post
// page is fine for both UX and Firestore read budget.
const COMMENTS_PER_PAGE = 500;

export async function listPostComments(
  postId: string,
): Promise<PostCommentDoc[]> {
  const snap = await adminDb()
    .collection("posts")
    .doc(postId)
    .collection("comments")
    .orderBy("createdAt", "asc")
    .limit(COMMENTS_PER_PAGE)
    .get();
  return snap.docs.map(fromSnap);
}
