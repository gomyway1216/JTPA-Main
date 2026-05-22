import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { PresentationDoc } from "@/lib/types";

function fromSnap(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): PresentationDoc {
  const data = doc.data() as Omit<PresentationDoc, "id">;
  return plainify({ ...data, id: doc.id });
}

export async function listPresentations(
  eventId: string,
): Promise<PresentationDoc[]> {
  const snap = await adminDb()
    .collection("events")
    .doc(eventId)
    .collection("presentations")
    .orderBy("createdAt", "asc")
    .get();
  return snap.docs.map(fromSnap);
}

export async function getMyPresentation(
  eventId: string,
  uid: string,
): Promise<PresentationDoc | null> {
  // We use the presenter's uid as the doc id, so getMyPresentation is a
  // single point read instead of a query — and it gives a stable key for
  // upserts in savePresentation.
  const snap = await adminDb()
    .collection("events")
    .doc(eventId)
    .collection("presentations")
    .doc(uid)
    .get();
  if (!snap.exists) return null;
  return plainify({ ...(snap.data() as Omit<PresentationDoc, "id">), id: snap.id });
}
