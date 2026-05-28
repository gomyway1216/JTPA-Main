"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { plainify } from "@/lib/data/serialize";
import { adminDb } from "@/lib/firebase/admin";
import { enqueueWaitlistPromotionNotification } from "@/lib/notifications";
import { cancellationDeltas } from "@/lib/rsvp-counters";
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
  // Strip Firestore Timestamp class instances before returning to the Client
  // Component; otherwise React rejects them with "Only plain objects... can be
  // passed to Client Components".
  return plainify(result);
}

export async function cancelRsvp({
  eventId,
}: {
  eventId: string;
}): Promise<void> {
  const user = await requireUser();
  const eventRef = adminDb().collection("events").doc(eventId);
  const rsvpRef = eventRef.collection("rsvps").doc(user.uid);

  // Notification info bubbles up out of the transaction as its return
  // value — assigning to outer `let`s from within the callback works at
  // runtime but TS can't track closure mutations, so the post-commit
  // narrowing breaks. Returning from the callback keeps TS happy AND
  // ensures we enqueue mail only ONCE per logical cancel (transactions
  // can retry; the callback may run multiple times, but the return
  // value reflects the committed state).
  type PromotionInfo = {
    to: string;
    displayName: string;
    eventTitle: string;
    eventSlug: string;
    role: RsvpDoc["role"];
  };

  const promotion = await adminDb().runTransaction<PromotionInfo | null>(
    async (tx) => {
      const [rsvpSnap, eventSnap] = await Promise.all([
        tx.get(rsvpRef),
        tx.get(eventRef),
      ]);
      if (!rsvpSnap.exists) return null;
      const prior = rsvpSnap.data() as RsvpDoc;
      if (prior.status === "cancelled") return null;
      const event = eventSnap.exists
        ? (eventSnap.data() as { title?: string; slug?: string })
        : null;

      // Only confirmed cancellations free a real seat — a waitlist
      // cancel just removes someone from the queue, no promotion
      // needed.
      const wasConfirmed = prior.status === "confirmed";

      // Inside the transaction we get a consistent read of the oldest
      // waitlist doc. The Admin SDK supports `tx.get(query)` with a
      // limit, which is exactly the FIFO promotion this needs.
      let promoteeDoc:
        | {
            ref: FirebaseFirestore.DocumentReference;
            data: RsvpDoc;
          }
        | null = null;
      if (wasConfirmed) {
        const waitlistQuery = eventRef
          .collection("rsvps")
          .where("status", "==", "waitlist")
          .orderBy("createdAt", "asc")
          .limit(1);
        const waitlistSnap = await tx.get(waitlistQuery);
        if (!waitlistSnap.empty) {
          const doc = waitlistSnap.docs[0];
          promoteeDoc = { ref: doc.ref, data: doc.data() as RsvpDoc };
        }
      }

      // Counter deltas live in cancellationDeltas() so the bucket
      // arithmetic gets its own unit-test surface — see
      // __tests__/lib/rsvp-counters.test.ts.
      const { rsvpDelta, waitlistDelta, presenterDelta } = cancellationDeltas({
        priorStatus: prior.status,
        priorRole: prior.role,
        promoteeRole: promoteeDoc ? promoteeDoc.data.role : null,
      });

      const now = Timestamp.now();
      tx.update(rsvpRef, {
        status: "cancelled" as const,
        updatedAt: now,
      });
      if (promoteeDoc) {
        tx.update(promoteeDoc.ref, {
          status: "confirmed" as const,
          updatedAt: now,
        });
      }
      tx.update(eventRef, {
        rsvpCount: FieldValue.increment(rsvpDelta),
        presenterCount: FieldValue.increment(presenterDelta),
        waitlistCount: FieldValue.increment(waitlistDelta),
        updatedAt: now,
      });

      if (promoteeDoc && event?.title && event?.slug) {
        return {
          to: promoteeDoc.data.email,
          displayName: promoteeDoc.data.displayName,
          eventTitle: event.title,
          eventSlug: event.slug,
          role: promoteeDoc.data.role,
        };
      }
      return null;
    },
  );

  // Post-commit notification. enqueueMail itself swallows its own
  // errors (see notifications.ts), so this won't block the cancel even
  // if Firestore mail-collection writes fail. Trigger Email is not
  // configured yet (#15), so the doc just sits queued — once #15
  // lands, the queued notification flushes through automatically.
  if (promotion) {
    await enqueueWaitlistPromotionNotification(promotion);
  }

  revalidatePath(`/events`);
  revalidatePath(`/events/[slug]`, "page");
  revalidatePath(`/my/rsvps`);
}
