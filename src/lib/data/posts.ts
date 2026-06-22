import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { contentMatchesLocale } from "@/lib/content-localization";
import { fromSnap, type SnapLike } from "@/lib/data/from-snap";
import { PostDocSchema } from "@/lib/data/schemas";
import { plainify } from "@/lib/data/serialize";
import type { PostDoc, PostStatus } from "@/lib/types";

function toDoc(doc: SnapLike): PostDoc {
  const data = fromSnap<Omit<PostDoc, "id">>(doc, PostDocSchema, "posts");
  return plainify({ ...data, id: doc.id });
}

function localeFilteredReadLimit(limit: number): number {
  return Math.min(Math.max(limit * 4, 100), 500);
}

export async function listPublishedPosts(limit = 50): Promise<PostDoc[]> {
  const snap = await adminDb()
    .collection("posts")
    .where("status", "==", "published")
    .orderBy("publishedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(toDoc);
}

export async function listPublishedPostsForLocale(
  locale: string,
  limit = 50,
): Promise<PostDoc[]> {
  const snap = await adminDb()
    .collection("posts")
    .where("status", "==", "published")
    .orderBy("publishedAt", "desc")
    .limit(localeFilteredReadLimit(limit))
    .get();
  return snap.docs
    .map(toDoc)
    .filter((post) => contentMatchesLocale(post.locales, locale))
    .slice(0, limit);
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
  return snap.docs.map(toDoc);
}

export async function listMyPosts(uid: string): Promise<PostDoc[]> {
  const snap = await adminDb()
    .collection("posts")
    .where("authorUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .get();
  return snap.docs.map(toDoc);
}

export async function getPostBySlug(slug: string): Promise<PostDoc | null> {
  const snap = await adminDb()
    .collection("posts")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return toDoc(snap.docs[0]);
}

export async function getPostById(id: string): Promise<PostDoc | null> {
  const snap = await adminDb().collection("posts").doc(id).get();
  if (!snap.exists) return null;
  return toDoc(snap);
}
