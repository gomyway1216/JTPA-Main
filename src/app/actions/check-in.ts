"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { requireAdmin, requireUser } from "@/lib/auth/session";
import { checkInWindowState, generateCheckInTokenString } from "@/lib/check-in";
import { plainify } from "@/lib/data/serialize";
import { adminDb } from "@/lib/firebase/admin";
import type { EventDoc, RsvpDoc } from "@/lib/types";

export type CheckInError =
  | "EVENT_NOT_FOUND"
  | "EVENT_CANCELLED"
  | "INVALID_TOKEN"
  | "TOKEN_NOT_SET"
  | "TOO_EARLY"
  | "TOO_LATE"
  | "MISSING_DATES";

class CheckInActionError extends Error {
  constructor(public code: CheckInError) {
    super(code);
  }
}

// Admin-only: generate (or rotate) the QR-code token for an event. Returns
// the new token so the admin page can render the updated QR without a full
// page refresh.
export async function generateCheckInToken(eventId: string): Promise<string> {
  await requireAdmin();
  const ref = adminDb().collection("events").doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) throw new CheckInActionError("EVENT_NOT_FOUND");
  const token = generateCheckInTokenString();
  await ref.update({
    checkInToken: token,
    updatedAt: Timestamp.now(),
  });
  revalidatePath(`/admin/events/${eventId}/checkin`);
  return token;
}

// Validates token + day-window. Throws on failure; returns the EventDoc on
// success so callers can re-use it without a second read.
async function loadValidatedEvent(
  eventId: string,
  token: string,
  tx?: FirebaseFirestore.Transaction,
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  data: EventDoc;
}> {
  const ref = adminDb().collection("events").doc(eventId);
  const snap = tx ? await tx.get(ref) : await ref.get();
  if (!snap.exists) throw new CheckInActionError("EVENT_NOT_FOUND");
  const data = snap.data() as EventDoc;
  if (data.status === "cancelled") {
    throw new CheckInActionError("EVENT_CANCELLED");
  }
  if (!data.checkInToken) throw new CheckInActionError("TOKEN_NOT_SET");
  if (data.checkInToken !== token) {
    throw new CheckInActionError("INVALID_TOKEN");
  }
  const window = checkInWindowState(data);
  if (window === "too_early") throw new CheckInActionError("TOO_EARLY");
  if (window === "too_late") throw new CheckInActionError("TOO_LATE");
  if (window === "missing_dates") {
    throw new CheckInActionError("MISSING_DATES");
  }
  return { ref, data };
}

export interface CheckInResult {
  rsvp: RsvpDoc;
  alreadyCheckedIn: boolean;
}

function normalizeAttendanceCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

// Signed-in user (Google account) self-check-in. Creates a walk-in RSVP if
// one doesn't already exist, sets `attendedAt`, and bumps both the event's
// `attendanceCount` and the user's `eventAttendanceCount` transactionally.
// Idempotent: calling twice returns the same doc with `alreadyCheckedIn=true`
// on the second call.
export async function selfCheckIn(
  eventId: string,
  token: string,
): Promise<CheckInResult> {
  const user = await requireUser();
  const result = await adminDb().runTransaction(async (tx) => {
    const { ref: eventRef, data: event } = await loadValidatedEvent(
      eventId,
      token,
      tx,
    );
    const rsvpRef = eventRef.collection("rsvps").doc(user.uid);
    const rsvpSnap = await tx.get(rsvpRef);
    const now = Timestamp.now();
    const prior = rsvpSnap.exists ? (rsvpSnap.data() as RsvpDoc) : null;

    const alreadyCheckedIn = !!prior?.attendedAt;
    const wasCountedAsRsvp =
      prior && (prior.status === "confirmed" || prior.status === "waitlist");
    const userRef = adminDb().collection("users").doc(user.uid);
    const userSnap = alreadyCheckedIn ? null : await tx.get(userRef);

    const doc: RsvpDoc = {
      uid: user.uid,
      displayName: prior?.displayName || user.displayName || user.email,
      email: prior?.email || user.email,
      affiliation: prior?.affiliation ?? "",
      role: prior?.role ?? "attendee",
      // Walk-ins go straight to confirmed even if capacity is over —
      // they're physically here, kicking them to the waitlist is silly.
      status: "confirmed",
      surveyResponses: prior?.surveyResponses ?? {},
      presentationTitle: prior?.presentationTitle,
      presentationAbstract: prior?.presentationAbstract,
      attendedAt: prior?.attendedAt ?? now,
      isGuest: prior?.isGuest,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(rsvpRef, doc);

    const eventPatch: Record<string, FirebaseFirestore.FieldValue | Date> = {};
    if (!wasCountedAsRsvp) {
      eventPatch.rsvpCount = FieldValue.increment(1);
    } else if (prior?.status === "waitlist") {
      // Promote from waitlist when they actually show up.
      eventPatch.rsvpCount = FieldValue.increment(1);
      eventPatch.waitlistCount = FieldValue.increment(-1);
    }
    // presenterCount tracks confirmed presenters. New doc is always
    // confirmed; prior might have been waitlist-presenter or
    // cancelled-presenter, both of which were excluded from the count.
    // Bumping here keeps the denormalized counter consistent.
    const newIsConfirmedPresenter = doc.role === "presenter";
    const priorWasConfirmedPresenter =
      prior?.status === "confirmed" && prior.role === "presenter";
    if (newIsConfirmedPresenter && !priorWasConfirmedPresenter) {
      eventPatch.presenterCount = FieldValue.increment(1);
    }
    if (!alreadyCheckedIn) {
      eventPatch.attendanceCount = FieldValue.increment(1);
    }
    if (Object.keys(eventPatch).length > 0) {
      eventPatch.updatedAt = now.toDate();
      tx.update(eventRef, eventPatch);
    }
    if (!alreadyCheckedIn && userSnap?.exists) {
      tx.update(userRef, {
        eventAttendanceCount:
          normalizeAttendanceCount(userSnap.get("eventAttendanceCount")) + 1,
        updatedAt: now,
      });
    }

    return { rsvp: doc, alreadyCheckedIn, eventSlug: event.slug };
  });

  revalidatePath("/events");
  revalidatePath(`/events/${result.eventSlug}`);
  revalidatePath(`/admin/attendees`);
  revalidatePath("/admin/users");
  revalidatePath("/my");
  revalidatePath(`/u/${user.uid}`);
  return { rsvp: plainify(result.rsvp), alreadyCheckedIn: result.alreadyCheckedIn };
}

// Admin manual check-in / un-check-in for the attendees table. Useful as a
// fallback when someone can't get the QR working at the door.
export async function setAttendance(
  eventId: string,
  rsvpUid: string,
  attended: boolean,
): Promise<void> {
  await requireAdmin();
  const eventRef = adminDb().collection("events").doc(eventId);
  const rsvpRef = eventRef.collection("rsvps").doc(rsvpUid);
  await adminDb().runTransaction(async (tx) => {
    const rsvpSnap = await tx.get(rsvpRef);
    if (!rsvpSnap.exists) throw new Error("RSVP_NOT_FOUND");
    const prior = rsvpSnap.data() as RsvpDoc;
    const wasCheckedIn = !!prior.attendedAt;
    if (wasCheckedIn === attended) return;
    const now = Timestamp.now();
    const userRef = adminDb().collection("users").doc(rsvpUid);
    const userSnap = prior.isGuest ? null : await tx.get(userRef);
    tx.update(rsvpRef, {
      attendedAt: attended ? now : FieldValue.delete(),
      updatedAt: now,
    });
    tx.update(eventRef, {
      attendanceCount: FieldValue.increment(attended ? 1 : -1),
      updatedAt: now,
    });
    if (userSnap?.exists) {
      const current = normalizeAttendanceCount(
        userSnap.get("eventAttendanceCount"),
      );
      tx.update(userRef, {
        eventAttendanceCount: Math.max(0, current + (attended ? 1 : -1)),
        updatedAt: now,
      });
    }
  });
  revalidatePath(`/admin/attendees`);
  revalidatePath("/admin/users");
  revalidatePath(`/u/${rsvpUid}`);
}
