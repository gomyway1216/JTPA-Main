"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";

import { createSessionCookie } from "@/lib/auth/session";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { checkInWindowState, generateCheckInTokenString } from "@/lib/check-in";
import { plainify } from "@/lib/data/serialize";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import type { EventDoc, RsvpDoc } from "@/lib/types";

export type CheckInError =
  | "EVENT_NOT_FOUND"
  | "EVENT_CANCELLED"
  | "INVALID_TOKEN"
  | "TOKEN_NOT_SET"
  | "TOO_EARLY"
  | "TOO_LATE"
  | "MISSING_DATES"
  | "GUEST_NAME_REQUIRED"
  | "GUEST_EMAIL_REQUIRED"
  | "INVALID_ID_TOKEN"
  | "NOT_ANONYMOUS";

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
// success so callers can re-use it without a second read. Shared between
// the signed-in and guest check-in paths.
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

// Signed-in user (Google account) self-check-in. Creates a walk-in RSVP if
// one doesn't already exist, sets `attendedAt`, and bumps `attendanceCount`
// transactionally. Idempotent: calling twice returns the same doc with
// `alreadyCheckedIn=true` on the second call.
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
    if (!alreadyCheckedIn) {
      eventPatch.attendanceCount = FieldValue.increment(1);
    }
    if (Object.keys(eventPatch).length > 0) {
      eventPatch.updatedAt = now.toDate();
      tx.update(eventRef, eventPatch);
    }

    // Silence the unused warning — `event` is fetched for validation only.
    void event;

    return { rsvp: doc, alreadyCheckedIn };
  });

  revalidatePath(`/admin/attendees`);
  return { rsvp: plainify(result.rsvp), alreadyCheckedIn: result.alreadyCheckedIn };
}

export interface GuestCheckInInput {
  eventId: string;
  token: string;
  // Firebase Anonymous-Auth ID token minted on the client.
  idToken: string;
  name: string;
  email: string;
}

// Walk-in flow: client signed in anonymously, server verifies the ID token,
// mints a session cookie so subsequent reads see the user as authenticated,
// then creates the RSVP+attendance in a transaction.
export async function guestCheckIn(
  input: GuestCheckInInput,
): Promise<CheckInResult> {
  const name = input.name.trim();
  const email = input.email.trim();
  if (!name) throw new CheckInActionError("GUEST_NAME_REQUIRED");
  if (!email) throw new CheckInActionError("GUEST_EMAIL_REQUIRED");

  let decoded: import("firebase-admin/auth").DecodedIdToken;
  try {
    decoded = await adminAuth().verifyIdToken(input.idToken, true);
  } catch {
    throw new CheckInActionError("INVALID_ID_TOKEN");
  }
  // Guard against a Google-signed-in client accidentally hitting this
  // path — they should go through `selfCheckIn` instead so we don't
  // overwrite their real RSVP with `isGuest=true`.
  if (decoded.firebase?.sign_in_provider !== "anonymous") {
    throw new CheckInActionError("NOT_ANONYMOUS");
  }

  const result = await adminDb().runTransaction(async (tx) => {
    const { ref: eventRef, data: event } = await loadValidatedEvent(
      input.eventId,
      input.token,
      tx,
    );
    const rsvpRef = eventRef.collection("rsvps").doc(decoded.uid);
    const rsvpSnap = await tx.get(rsvpRef);
    const now = Timestamp.now();
    const prior = rsvpSnap.exists ? (rsvpSnap.data() as RsvpDoc) : null;

    const alreadyCheckedIn = !!prior?.attendedAt;
    const wasCountedAsRsvp =
      prior && (prior.status === "confirmed" || prior.status === "waitlist");

    const doc: RsvpDoc = {
      uid: decoded.uid,
      displayName: name,
      email,
      affiliation: prior?.affiliation ?? "",
      role: "attendee",
      status: "confirmed",
      surveyResponses: prior?.surveyResponses ?? {},
      attendedAt: prior?.attendedAt ?? now,
      isGuest: true,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(rsvpRef, doc);

    const eventPatch: Record<string, FirebaseFirestore.FieldValue | Date> = {};
    if (!wasCountedAsRsvp) {
      eventPatch.rsvpCount = FieldValue.increment(1);
    } else if (prior?.status === "waitlist") {
      eventPatch.rsvpCount = FieldValue.increment(1);
      eventPatch.waitlistCount = FieldValue.increment(-1);
    }
    if (!alreadyCheckedIn) {
      eventPatch.attendanceCount = FieldValue.increment(1);
    }
    if (Object.keys(eventPatch).length > 0) {
      eventPatch.updatedAt = now.toDate();
      tx.update(eventRef, eventPatch);
    }
    void event;

    return { rsvp: doc, alreadyCheckedIn };
  });

  // Mint the session cookie AFTER the write succeeds, so a failed write
  // doesn't leave a half-authenticated browser. Subsequent server reads
  // will now see `getSessionUser()` returning this anonymous uid.
  await createSessionCookie(input.idToken);

  revalidatePath(`/admin/attendees`);
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
    tx.update(rsvpRef, {
      attendedAt: attended ? now : FieldValue.delete(),
      updatedAt: now,
    });
    tx.update(eventRef, {
      attendanceCount: FieldValue.increment(attended ? 1 : -1),
      updatedAt: now,
    });
  });
  revalidatePath(`/admin/attendees`);
}
