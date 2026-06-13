import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { fromSnap, type SnapLike } from "@/lib/data/from-snap";
import { EventDocSchema } from "@/lib/data/schemas";
import { plainify } from "@/lib/data/serialize";
import type { EventDoc, EventStatus } from "@/lib/types";
import { toDate } from "@/lib/utils";

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

function adminEventStatus(event: EventDoc): EventStatus | undefined {
  return (event as Partial<EventDoc>).status;
}

function eventStartMillis(event: EventDoc): number {
  const start = toDate((event as Partial<EventDoc>).startAt);
  return start?.getTime() ?? Number.POSITIVE_INFINITY;
}

function compareEventsByStartAt(a: EventDoc, b: EventDoc): number {
  const aStart = eventStartMillis(a);
  const bStart = eventStartMillis(b);
  if (aStart !== bStart) return aStart < bStart ? -1 : 1;
  const aTitle = (a as Partial<EventDoc>).title ?? "";
  const bTitle = (b as Partial<EventDoc>).title ?? "";
  return aTitle.localeCompare(bTitle, "ja") || a.id.localeCompare(b.id);
}

export async function listEventsForAdmin(opts: {
  statuses?: EventStatus[];
  limit?: number;
} = {}): Promise<EventDoc[]> {
  const snap = await adminDb().collection("events").get();
  const events = snap.docs
    .map(toDoc)
    .filter((event) => {
      if (!opts.statuses) return true;
      const status = adminEventStatus(event);
      // Legacy docs without status are exactly the records admins need to
      // discover and normalize, so keep them visible in admin filtered lists.
      return status === undefined || opts.statuses.includes(status);
    })
    .sort(compareEventsByStartAt);

  return typeof opts.limit === "number" ? events.slice(0, opts.limit) : events;
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
