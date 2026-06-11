import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { fromSnap, type SnapLike } from "@/lib/data/from-snap";
import { GuideDocSchema } from "@/lib/data/schemas";
import { plainify } from "@/lib/data/serialize";
import type { GuideDoc, GuideStatus } from "@/lib/types";

function toDoc(doc: SnapLike): GuideDoc {
  const data = fromSnap<Omit<GuideDoc, "id">>(doc, GuideDocSchema, "guides");
  return plainify({ ...data, id: doc.id });
}

export async function listGuides(
  opts: { statuses?: GuideStatus[]; limit?: number } = {},
): Promise<GuideDoc[]> {
  const { statuses = ["published"], limit = 100 } = opts;
  // Firestore's `in` operator rejects empty arrays and caps at 10 values.
  // GuideStatus has five variants so the cap isn't reachable today, but
  // guard the empty case so a caller passing `[]` gets `[]` back instead
  // of a runtime crash.
  if (statuses.length === 0) return [];
  const snap = await adminDb()
    .collection("guides")
    .where("status", "in", statuses)
    .orderBy("order", "asc")
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(toDoc);
}

// Per-status query for the admin review queue. Mirrors `listPostsByStatus`.
// Indexed by `status + updatedAt DESC` (composite index added in
// `firestore.indexes.json` alongside the existing guides index).
export async function listGuidesByStatus(
  status: GuideStatus,
  limit = 100,
): Promise<GuideDoc[]> {
  const snap = await adminDb()
    .collection("guides")
    .where("status", "==", status)
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(toDoc);
}

// List guides the given user has authored. Used by `/my/guides` so a
// community contributor can see the status of every guide they've
// submitted (draft, pending, published, rejected). Legacy guides
// created before the community-submission flow may not have
// `authorUid` — those won't appear here, which is fine because they
// were all created by admin/editor who already use /admin/guides.
export async function listMyGuides(uid: string): Promise<GuideDoc[]> {
  const snap = await adminDb()
    .collection("guides")
    .where("authorUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .get();
  return snap.docs.map(toDoc);
}

export async function getGuideById(id: string): Promise<GuideDoc | null> {
  const snap = await adminDb().collection("guides").doc(id).get();
  if (!snap.exists) return null;
  return toDoc(snap);
}

export async function getGuideBySlug(slug: string): Promise<GuideDoc | null> {
  const snap = await adminDb()
    .collection("guides")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return toDoc(snap.docs[0]);
}
