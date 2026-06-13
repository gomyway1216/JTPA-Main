import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { RsvpDoc } from "@/lib/types";

export interface MyRsvpEntry {
  eventId: string;
  rsvp: RsvpDoc;
}

export async function getMyRsvp(
  eventId: string,
  uid: string,
): Promise<RsvpDoc | null> {
  const snap = await adminDb()
    .collection("events")
    .doc(eventId)
    .collection("rsvps")
    .doc(uid)
    .get();
  if (!snap.exists) return null;
  return plainify(snap.data() as RsvpDoc);
}

export async function listRsvps(eventId: string): Promise<RsvpDoc[]> {
  const snap = await adminDb()
    .collection("events")
    .doc(eventId)
    .collection("rsvps")
    .orderBy("createdAt", "asc")
    .get();
  return snap.docs.map((d) => plainify(d.data() as RsvpDoc));
}

export async function listMyRsvpEventIds(uid: string): Promise<string[]> {
  return (await listMyRsvps(uid)).map(({ eventId }) => eventId);
}

export async function listMyRsvps(uid: string): Promise<MyRsvpEntry[]> {
  const snap = await adminDb()
    .collectionGroup("rsvps")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .get();
  return snap.docs
    .map((d) => {
      const eventId = d.ref.parent.parent?.id;
      if (!eventId) return null;
      return { eventId, rsvp: plainify(d.data() as RsvpDoc) };
    })
    .filter((v): v is MyRsvpEntry => !!v);
}
