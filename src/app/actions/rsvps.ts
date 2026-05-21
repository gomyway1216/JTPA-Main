"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type { RsvpDoc } from "@/lib/types";

interface SubmitRsvpInput {
  eventId: string;
  role: "attendee" | "presenter";
  affiliation?: string;
  surveyResponses: Record<string, string>;
  presentationTitle?: string;
  presentationAbstract?: string;
}

export async function submitRsvp(input: SubmitRsvpInput): Promise<RsvpDoc> {
  const user = await requireUser();
  const eventRef = adminDb().collection("events").doc(input.eventId);
  const rsvpRef = eventRef.collection("rsvps").doc(user.uid);

  const result = await adminDb().runTransaction(async (tx) => {
    const [eventSnap, rsvpSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(rsvpRef),
    ]);
    if (!eventSnap.exists) throw new Error("EVENT_NOT_FOUND");
    const event = eventSnap.data() as {
      capacity: number;
      presenterCapacity: number;
      rsvpCount: number;
      presenterCount: number;
      waitlistCount: number;
      status: string;
    };
    if (event.status === "cancelled") throw new Error("EVENT_CANCELLED");

    const prior = rsvpSnap.exists ? (rsvpSnap.data() as RsvpDoc) : null;
    const now = Timestamp.now();

    // Compute counter deltas based on prior and new state.
    let rsvpDelta = 0;
    let presenterDelta = 0;
    let waitlistDelta = 0;

    const isWaitlist =
      event.capacity > 0 &&
      event.rsvpCount >= event.capacity &&
      (!prior || prior.status === "cancelled");
    const newStatus: RsvpDoc["status"] = isWaitlist ? "waitlist" : "confirmed";

    if (!prior || prior.status === "cancelled") {
      if (newStatus === "waitlist") waitlistDelta = 1;
      else rsvpDelta = 1;
      if (newStatus === "confirmed" && input.role === "presenter") {
        presenterDelta = 1;
      }
    } else {
      if (prior.role === "presenter" && input.role === "attendee") {
        presenterDelta = -1;
      } else if (prior.role === "attendee" && input.role === "presenter") {
        presenterDelta = 1;
      }
    }

    const doc: RsvpDoc = {
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      affiliation: input.affiliation ?? prior?.affiliation ?? "",
      role: input.role,
      status: newStatus,
      surveyResponses: input.surveyResponses,
      presentationTitle: input.presentationTitle,
      presentationAbstract: input.presentationAbstract,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };

    tx.set(rsvpRef, doc);
    if (rsvpDelta || presenterDelta || waitlistDelta) {
      tx.update(eventRef, {
        rsvpCount: FieldValue.increment(rsvpDelta),
        presenterCount: FieldValue.increment(presenterDelta),
        waitlistCount: FieldValue.increment(waitlistDelta),
        updatedAt: now,
      });
    }
    return doc;
  });

  revalidatePath(`/events`);
  revalidatePath(`/my/rsvps`);
  return result;
}

export async function cancelRsvp({
  eventId,
}: {
  eventId: string;
}): Promise<void> {
  const user = await requireUser();
  const eventRef = adminDb().collection("events").doc(eventId);
  const rsvpRef = eventRef.collection("rsvps").doc(user.uid);

  await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(rsvpRef);
    if (!snap.exists) return;
    const prior = snap.data() as RsvpDoc;
    if (prior.status === "cancelled") return;

    const rsvpDelta = prior.status === "confirmed" ? -1 : 0;
    const presenterDelta =
      prior.status === "confirmed" && prior.role === "presenter" ? -1 : 0;
    const waitlistDelta = prior.status === "waitlist" ? -1 : 0;

    tx.update(rsvpRef, {
      status: "cancelled" as const,
      updatedAt: Timestamp.now(),
    });
    tx.update(eventRef, {
      rsvpCount: FieldValue.increment(rsvpDelta),
      presenterCount: FieldValue.increment(presenterDelta),
      waitlistCount: FieldValue.increment(waitlistDelta),
      updatedAt: Timestamp.now(),
    });
  });

  revalidatePath(`/events`);
  revalidatePath(`/my/rsvps`);
}
