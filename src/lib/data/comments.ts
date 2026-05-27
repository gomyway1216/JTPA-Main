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

export async function listPostComments(
  postId: string,
): Promise<PostCommentDoc[]> {
  const snap = await adminDb()
    .collection("posts")
    .doc(postId)
    .collection("comments")
    .orderBy("createdAt", "asc")
    .get();
  return snap.docs.map(fromSnap);
}
