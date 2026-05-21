import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { RsvpDoc } from "@/lib/types";

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
  const snap = await adminDb()
    .collectionGroup("rsvps")
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .get();
  return snap.docs
    .map((d) => d.ref.parent.parent?.id)
    .filter((v): v is string => !!v);
}
