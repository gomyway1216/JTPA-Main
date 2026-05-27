import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { PostDoc, PostStatus } from "@/lib/types";

function fromSnap(doc: FirebaseFirestore.QueryDocumentSnapshot): PostDoc {
  const data = doc.data() as Omit<PostDoc, "id">;
  return plainify({ ...data, id: doc.id });
}

export async function listPublishedPosts(limit = 50): Promise<PostDoc[]> {
  const snap = await adminDb()
    .collection("posts")
    .where("status", "==", "published")
    .orderBy("publishedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(fromSnap);
}

export async function listPostsByStatus(
  status: PostStatus,
  limit = 100,
): Promise<PostDoc[]> {
  const snap = await adminDb()
    .collection("posts")
    .where("status", "==", status)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(fromSnap);
}

export async function listMyPosts(uid: string): Promise<PostDoc[]> {
  const snap = await adminDb()
    .collection("posts")
    .where("authorUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .get();
  return snap.docs.map(fromSnap);
}

export async function getPostBySlug(slug: string): Promise<PostDoc | null> {
  const snap = await adminDb()
    .collection("posts")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return fromSnap(snap.docs[0]);
}

export async function getPostById(id: string): Promise<PostDoc | null> {
  const snap = await adminDb().collection("posts").doc(id).get();
  if (!snap.exists) return null;
  return plainify({ ...(snap.data() as Omit<PostDoc, "id">), id: snap.id });
}
