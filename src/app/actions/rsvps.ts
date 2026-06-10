"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/session";
import { plainify } from "@/lib/data/serialize";
import { adminDb } from "@/lib/firebase/admin";
import { actionError } from "@/lib/i18n/action-errors";
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

export async function submitRsvp(
  input: SubmitRsvpInput,
): Promise<{ ok: true; rsvp: RsvpDoc } | { ok: false; error: string }> {
  const user = await requireUser();
  const eventRef = adminDb().collection("events").doc(input.eventId);
  const rsvpRef = eventRef.collection("rsvps").doc(user.uid);

  const result = await adminDb().runTransaction(async (tx) => {
    const [eventSnap, rsvpSnap] = await Promise.all([
      tx.get(eventRef),
      tx.get(rsvpRef),
    ]);
    if (!eventSnap.exists) {
      return {
        ok: false as const,
        error: await actionError("eventNotFoundDeleted"),
      };
    }
    const event = eventSnap.data() as {
      capacity: number;
      presenterCapacity: number;
      rsvpCount: number;
      presenterCount: number;
      waitlistCount: number;
      status: string;
    };
    if (event.status === "cancelled") {
      return {
        ok: false as const,
        error: await actionError("eventCancelledRsvp"),
      };
    }

    const prior = rsvpSnap.exists ? (rsvpSnap.data() as RsvpDoc) : null;
    const now = Timestamp.now();

    // Compute counter deltas based on prior and new state.
    let rsvpDelta = 0;
    let presenterDelta = 0;
    let waitlistDelta = 0;

    // Editing an existing RSVP must PRESERVE its current status: a
    // confirmed RSVP stays confirmed, a waitlisted one stays waitlisted.
    // Re-evaluating capacity on every edit would silently promote a
    // waitlisted user to "confirmed" past capacity AND leave the bucket
    // counters desynced (waitlistCount too high, rsvpCount too low),
    // since the edit branch moves no rsvp/waitlist deltas. Promotion off
    // the waitlist happens only via the cancel→promote flow. Capacity is
    // therefore evaluated solely for a brand-new RSVP or a re-RSVP after
    // cancellation.
    const isExisting = !!prior && prior.status !== "cancelled";
    let newStatus: RsvpDoc["status"];

    if (!isExisting) {
      const isWaitlist =
        event.capacity > 0 && event.rsvpCount >= event.capacity;
      newStatus = isWaitlist ? "waitlist" : "confirmed";
      if (isWaitlist) waitlistDelta = 1;
      else rsvpDelta = 1;
      if (newStatus === "confirmed" && input.role === "presenter") {
        presenterDelta = 1;
      }
    } else {
      newStatus = prior.status; // preserve "confirmed" or "waitlist"
      // presenterCount tracks CONFIRMED presenters only, so a role switch
      // moves it only while the RSVP is confirmed — a waitlisted role
      // switch must leave presenterCount untouched.
      if (newStatus === "confirmed") {
        if (prior.role === "presenter" && input.role === "attendee") {
          presenterDelta = -1;
        } else if (prior.role === "attendee" && input.role === "presenter") {
          presenterDelta = 1;
        }
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
      // Preserve check-in markers across RSVP edits. tx.set() overwrites
      // the whole doc, so without forwarding these the attendee would
      // appear "un-checked-in" after editing their answers while the
      // event's attendanceCount still reflects them. Admin SDK strips
      // undefined, so an attendee who never checked in still ends up
      // with the fields absent.
      attendedAt: prior?.attendedAt,
      isGuest: prior?.isGuest,
      // Keep the original queue position only for a true edit of a live
      // (confirmed/waitlist) RSVP. A re-registration after cancellation is
      // NOT existing, so it gets a fresh `now`: the waitlist is FIFO by
      // `createdAt asc`, and reusing the old (earlier) timestamp would let a
      // re-registering user jump ahead of everyone who signed up in the
      // meantime. (When isExisting is true, `prior` is non-null.)
      createdAt: isExisting && prior ? (prior.createdAt ?? now) : now,
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
    return { ok: true as const, doc };
  });

  // Expected failures (cancelled / deleted event) come back as an error
  // result from the transaction — return it so the form shows the real
  // reason instead of the masked generic "Server Components render" crash.
  if (!result.ok) return result;

  revalidatePath(`/events`);
  revalidatePath(`/my/rsvps`);
  // Strip Firestore Timestamp class instances before returning to the Client
  // Component; otherwise React rejects them with "Only plain objects... can be
  // passed to Client Components".
  return { ok: true, rsvp: plainify(result.doc) };
}

export async function cancelRsvp({
  eventId,
}: {
  eventId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
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

  const result = await adminDb().runTransaction<
    { ok: false; error: string } | { ok: true; promotion: PromotionInfo | null }
  >(async (tx) => {
      const [rsvpSnap, eventSnap] = await Promise.all([
        tx.get(rsvpRef),
        tx.get(eventRef),
      ]);
      // No RSVP / already cancelled = nothing to do = idempotent success.
      if (!rsvpSnap.exists) return { ok: true as const, promotion: null };
      const prior = rsvpSnap.data() as RsvpDoc;
      if (prior.status === "cancelled") {
        return { ok: true as const, promotion: null };
      }
      // Defensive check, mirrors submitRsvp: if the event doc was
      // deleted between the original RSVP and this cancel, the later
      // `tx.update(eventRef, …)` would fail with a cryptic Firestore
      // error. Return the same not-found message submitRsvp uses so the
      // user sees a consistent reason (per PR #61, and #117 review).
      if (!eventSnap.exists) {
        return {
          ok: false as const,
          error: await actionError("eventNotFoundDeleted"),
        };
      }
      const event = eventSnap.data() as { title: string; slug: string };

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

      // `event` is guaranteed non-null + properly typed after the
      // not-found guard above, so no optional-chaining needed.
      if (promoteeDoc) {
        return {
          ok: true as const,
          promotion: {
            to: promoteeDoc.data.email,
            displayName: promoteeDoc.data.displayName,
            eventTitle: event.title,
            eventSlug: event.slug,
            role: promoteeDoc.data.role,
          },
        };
      }
      return { ok: true as const, promotion: null };
    },
  );

  // Post-commit notification. enqueueMail itself swallows its own
  // errors (see notifications.ts), so this won't block the cancel even
  // if Firestore mail-collection writes fail. Trigger Email is not
  // configured yet (#15), so the doc just sits queued — once #15
  // lands, the queued notification flushes through automatically.
  // Expected failure (event deleted mid-cancel) surfaces as a real message.
  if (!result.ok) return result;
  const promotion = result.promotion;
  if (promotion) {
    await enqueueWaitlistPromotionNotification(promotion);
  }

  revalidatePath(`/events`);
  revalidatePath(`/events/[slug]`, "page");
  revalidatePath(`/my/rsvps`);
  return { ok: true };
}
