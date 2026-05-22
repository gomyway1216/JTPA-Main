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
