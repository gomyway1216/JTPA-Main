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
  // Filter to events that haven't ended yet. Tested against `endAt` (not
  // `startAt`), so an event that's currently happening still surfaces as
  // "upcoming" — important for last-minute RSVPs when an admin hasn't
  // flipped status to `past` yet. Replaces the previous `futureOnly`
  // semantics which used startAt and incorrectly excluded ongoing events.
  notEndedOnly?: boolean;
} = {}): Promise<EventDoc[]> {
  const { statuses = ["published"], limit = 20, notEndedOnly = false } = opts;
  let q: FirebaseFirestore.Query = adminDb()
    .collection("events")
    .where("status", "in", statuses);
  if (notEndedOnly) {
    q = q.where("endAt", ">=", Timestamp.now());
  }
  q = q.orderBy("startAt", "asc").limit(limit);
  const snap = await q.get();
  return snap.docs.map(fromSnap);
}

export async function listPastEvents(limit = 20): Promise<EventDoc[]> {
  // Include both explicitly-`past` events and `published` events whose
  // `endAt` has slipped into the past (issue #20: don't wait for admin
  // to manually flip status). Sort newest-first.
  const snap = await adminDb()
    .collection("events")
    .where("status", "in", ["past", "published"])
    .where("endAt", "<", Timestamp.now())
    .orderBy("endAt", "desc")
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
