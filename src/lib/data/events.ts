import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { EventDoc, EventStatus } from "@/lib/types";

function fromSnap(doc: FirebaseFirestore.QueryDocumentSnapshot): EventDoc {
  const data = doc.data() as Omit<EventDoc, "id">;
  return plainify({ ...data, id: doc.id });
}

export async function listEvents(opts: {
  statuses?: EventStatus[];
  limit?: number;
  futureOnly?: boolean;
} = {}): Promise<EventDoc[]> {
  const { statuses = ["published"], limit = 20, futureOnly = false } = opts;
  let q: FirebaseFirestore.Query = adminDb()
    .collection("events")
    .where("status", "in", statuses);
  if (futureOnly) {
    q = q.where("startAt", ">=", Timestamp.now());
  }
  q = q.orderBy("startAt", "asc").limit(limit);
  const snap = await q.get();
  return snap.docs.map(fromSnap);
}

export async function listPastEvents(limit = 20): Promise<EventDoc[]> {
  const snap = await adminDb()
    .collection("events")
    .where("status", "in", ["past", "published"])
    .where("startAt", "<", Timestamp.now())
    .orderBy("startAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(fromSnap);
}

export async function getEventBySlug(slug: string): Promise<EventDoc | null> {
  const snap = await adminDb()
    .collection("events")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return fromSnap(snap.docs[0]);
}

export async function getEventById(id: string): Promise<EventDoc | null> {
  const snap = await adminDb().collection("events").doc(id).get();
  if (!snap.exists) return null;
  return plainify({ ...(snap.data() as Omit<EventDoc, "id">), id: snap.id });
}
