import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { GuideDoc, GuideStatus } from "@/lib/types";

function fromSnap(doc: FirebaseFirestore.QueryDocumentSnapshot): GuideDoc {
  const data = doc.data() as Omit<GuideDoc, "id">;
  return plainify({ ...data, id: doc.id });
}

export async function listGuides(
  opts: { statuses?: GuideStatus[]; limit?: number } = {},
): Promise<GuideDoc[]> {
  const { statuses = ["published"], limit = 100 } = opts;
  // Firestore's `in` operator rejects empty arrays and caps at 10 values.
  // GuideStatus only has two variants so the upper bound isn't reachable
  // today, but guard the empty case so a caller passing `[]` gets `[]`
  // back instead of a runtime crash.
  if (statuses.length === 0) return [];
  const snap = await adminDb()
    .collection("guides")
    .where("status", "in", statuses)
    .orderBy("order", "asc")
    .orderBy("updatedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(fromSnap);
}

export async function getGuideById(id: string): Promise<GuideDoc | null> {
  const snap = await adminDb().collection("guides").doc(id).get();
  if (!snap.exists) return null;
  return plainify({ ...(snap.data() as Omit<GuideDoc, "id">), id: snap.id });
}

export async function getGuideBySlug(slug: string): Promise<GuideDoc | null> {
  const snap = await adminDb()
    .collection("guides")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return fromSnap(snap.docs[0]);
}
