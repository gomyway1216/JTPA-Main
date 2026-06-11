import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { fromSnap, type SnapLike } from "@/lib/data/from-snap";
import { EventDocSchema } from "@/lib/data/schemas";
import { plainify } from "@/lib/data/serialize";
import type { EventDoc, EventStatus } from "@/lib/types";

function toDoc(doc: SnapLike): EventDoc {
  const data = fromSnap<Omit<EventDoc, "id">>(doc, EventDocSchema, "events");
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
  // Firestore requires the first orderBy to match any inequality filter,
  // so the `notEndedOnly` path orders by endAt. For practical UX this is
  // close enough to startAt order: ongoing events (endAt soonest) sort
  // first, upcoming events follow. Without `notEndedOnly` we keep the
  // intuitive startAt ascending sort.
  if (notEndedOnly) {
    q = q.where("endAt", ">=", Timestamp.now()).orderBy("endAt", "asc");
  } else {
    q = q.orderBy("startAt", "asc");
  }
  q = q.limit(limit);
  const snap = await q.get();
  return snap.docs.map(toDoc);
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
  return snap.docs.map(toDoc);
}

export async function getEventBySlug(slug: string): Promise<EventDoc | null> {
  const snap = await adminDb()
    .collection("events")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return toDoc(snap.docs[0]);
}

export async function getEventById(id: string): Promise<EventDoc | null> {
  const snap = await adminDb().collection("events").doc(id).get();
  if (!snap.exists) return null;
  return toDoc(snap);
}
