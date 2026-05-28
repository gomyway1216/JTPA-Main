import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { QaDoc, QaStatus } from "@/lib/types";

function fromSnap(doc: FirebaseFirestore.QueryDocumentSnapshot): QaDoc {
  const data = doc.data() as Omit<QaDoc, "id">;
  return plainify({
    // Default the optional `likeCount` so the type matches the runtime
    // even on docs created before the field existed.
    likeCount: 0,
    ...data,
    id: doc.id,
  });
}

export async function listQa(
  opts: { statuses?: QaStatus[]; limit?: number } = {},
): Promise<QaDoc[]> {
  const { statuses = ["published"], limit = 50 } = opts;
  // Firestore's `in` rejects empty arrays; the QaStatus union is small
  // enough that we won't exceed the 10-value cap. Bail out early so a
  // caller passing `[]` doesn't crash.
  if (statuses.length === 0) return [];
  const snap = await adminDb()
    .collection("qa")
    .where("status", "in", statuses)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(fromSnap);
}

export async function listMyQa(uid: string): Promise<QaDoc[]> {
  // No status filter — authors can see their own archived posts too so
  // they can see why their question disappeared from public view.
  const snap = await adminDb()
    .collection("qa")
    .where("authorUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .limit(100)
    .get();
  return snap.docs.map(fromSnap);
}

export async function getQaById(id: string): Promise<QaDoc | null> {
  const snap = await adminDb().collection("qa").doc(id).get();
  if (!snap.exists) return null;
  return plainify({
    likeCount: 0,
    ...(snap.data() as Omit<QaDoc, "id">),
    id: snap.id,
  });
}

export async function getQaBySlug(slug: string): Promise<QaDoc | null> {
  const snap = await adminDb()
    .collection("qa")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return fromSnap(snap.docs[0]);
}
