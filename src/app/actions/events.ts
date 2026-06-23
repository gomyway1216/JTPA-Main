"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath, updateTag } from "next/cache";
import * as z from "zod";

import {
  deleteStoragePaths,
  findUniqueSlug,
  parseInput,
} from "@/lib/actions/shared";
import { requireAdmin } from "@/lib/auth/session";
import { EVENTS_TAG } from "@/lib/data/cache-tags";
import { adminDb } from "@/lib/firebase/admin";
import { actionError, defaultActionError } from "@/lib/i18n/action-errors";
import {
  DEFAULT_CHECKIN_EARLY_MINUTES,
  DEFAULT_CHECKIN_LATE_MINUTES,
  MAX_CHECKIN_WINDOW_MINUTES,
} from "@/lib/check-in";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import {
  DEFAULT_EVENT_TIME_ZONE,
  dateTimeLocalToDate,
  eventTimeZone,
  isValidTimeZone,
} from "@/lib/time-zones";
import { slugify } from "@/lib/utils";
import type { EventDoc } from "@/lib/types";

const SurveyFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "select", "checkbox"]),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  audience: z.enum(["all", "presenter"]),
});

const AssetSchema = z.object({
  path: z.string().min(1),
  url: z.string().url(),
});

const CheckInWindowMinutesSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(MAX_CHECKIN_WINDOW_MINUTES);

const TimeZoneSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .refine(isValidTimeZone, "Invalid time zone")
    .default(DEFAULT_EVENT_TIME_ZONE),
);

// Pre-process empty strings on optional URL/slug fields into `undefined` so the
// validator doesn't reject a blank form field as a length/regex violation.
const optionalNonEmpty = (schema: z.ZodTypeAny) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const EventInputSchema = z.object({
  title: z.string().min(2).max(200),
  slug: optionalNonEmpty(z.string().min(2).max(80).regex(/^[a-z0-9-]+$/)),
  description: z.string().min(1).max(20000),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  timeZone: TimeZoneSchema,
  locationType: z.enum(["online", "offline", "hybrid"]),
  address: z.string().optional(),
  mapUrl: optionalNonEmpty(z.string().url()),
  meetingUrl: optionalNonEmpty(z.string().url()),
  capacity: z.coerce.number().int().min(0),
  presenterCapacity: z.coerce.number().int().min(0),
  status: z.enum(["draft", "published", "past", "cancelled"]),
  // Optional in the schema so existing forms / older clients keep working;
  // we default to "public" when writing to Firestore below.
  visibility: z.enum(["public", "members_only"]).optional(),
  checkInEarlyMinutes: CheckInWindowMinutesSchema.optional(),
  checkInLateMinutes: CheckInWindowMinutesSchema.optional(),
  coverImage: AssetSchema.optional(),
  subImages: z.array(AssetSchema).default([]),
  surveyFields: z.array(SurveyFieldSchema).default([]),
});

export type EventFormInput = z.input<typeof EventInputSchema>;

function uniqueStoragePaths(paths: Array<string | undefined>): string[] {
  return Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
}

function eventImagePaths(
  event: Pick<EventDoc, "coverImage" | "subImages">,
): string[] {
  return uniqueStoragePaths([
    event.coverImage?.path,
    ...(event.subImages ?? []).map((image) => image.path),
  ]);
}

type EventDateTimeParseResult =
  | { ok: true; startAt: Date; endAt: Date }
  | { ok: false; error: string };

async function parseEventDateTimes(parsed: {
  startAt: string;
  endAt: string;
  timeZone: string;
}): Promise<EventDateTimeParseResult> {
  const startAt = dateTimeLocalToDate(parsed.startAt, parsed.timeZone);
  const endAt = dateTimeLocalToDate(parsed.endAt, parsed.timeZone);
  if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) {
    return { ok: false, error: await actionError("invalidEventDateTime") };
  }
  return { ok: true, startAt, endAt };
}

// createEvent / cloneEvent redirect on success (so they only ever *return*
// on failure); updateEvent returns { ok: true }. Returning the error rather
// than throwing it is what lets the real message reach the admin — Next
// masks thrown Server Action errors as a generic digest in production (same
// reasoning as users.ts / presentations.ts, per PR #59).
export type EventSaveResult = { ok: true } | { ok: false; error: string };

export async function createEvent(
  input: EventFormInput,
): Promise<EventSaveResult> {
  const admin = await requireAdmin();
  const pr = await parseInput(EventInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
  const dateTimes = await parseEventDateTimes(parsed);
  if (!dateTimes.ok) return dateTimes;

  const requestedSlug = parsed.slug as string | undefined;
  const slug = requestedSlug || slugify(parsed.title);
  // Ensure slug uniqueness
  const existing = await adminDb()
    .collection("events")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (!existing.empty) {
    return { ok: false, error: await actionError("slugTaken", { slug }) };
  }

  const now = Timestamp.now();
  const ref = await adminDb().collection("events").add({
    slug,
    title: parsed.title,
    description: parsed.description,
    startAt: Timestamp.fromDate(dateTimes.startAt),
    endAt: Timestamp.fromDate(dateTimes.endAt),
    timeZone: parsed.timeZone,
    location: {
      type: parsed.locationType,
      address: parsed.address ?? "",
      mapUrl: parsed.mapUrl || "",
      meetingUrl: parsed.meetingUrl || "",
    },
    capacity: parsed.capacity,
    presenterCapacity: parsed.presenterCapacity,
    status: parsed.status,
    visibility: parsed.visibility ?? "public",
    checkInEarlyMinutes:
      parsed.checkInEarlyMinutes ?? DEFAULT_CHECKIN_EARLY_MINUTES,
    checkInLateMinutes:
      parsed.checkInLateMinutes ?? DEFAULT_CHECKIN_LATE_MINUTES,
    coverImage: parsed.coverImage,
    subImages: parsed.subImages,
    surveyFields: parsed.surveyFields,
    rsvpCount: 0,
    presenterCount: 0,
    waitlistCount: 0,
    createdBy: admin.uid,
    createdAt: now,
    updatedAt: now,
  });

  // Expire the cached / + /events lists (src/lib/data/cached.ts) in both locales.
  updateTag(EVENTS_TAG);
  revalidatePath("/events");
  revalidatePath("/admin/events");
  return redirectToLocalizedPath(`/admin/events/${ref.id}/edit`);
}

export async function updateEvent(
  eventId: string,
  input: EventFormInput,
): Promise<EventSaveResult> {
  await requireAdmin();
  const pr = await parseInput(EventInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
  const dateTimes = await parseEventDateTimes(parsed);
  if (!dateTimes.ok) return dateTimes;
  const ref = adminDb().collection("events").doc(eventId);
  const snap = await ref.get();
  // If the event was deleted out from under the editor, `ref.update` would
  // throw a Firestore NOT_FOUND that prod masks as the generic crash —
  // surface it instead. Per PR #116 Gemini review.
  if (!snap.exists) {
    return {
      ok: false,
      error: await actionError("eventNotFoundDeleted"),
    };
  }
  const cur = snap.data() as EventDoc;

  const requestedSlug = parsed.slug as string | undefined;
  if (requestedSlug) {
    const conflict = await adminDb()
      .collection("events")
      .where("slug", "==", requestedSlug)
      .limit(2)
      .get();
    if (conflict.docs.some((d) => d.id !== eventId)) {
      return {
        ok: false,
        error: await actionError("slugTaken", { slug: requestedSlug }),
      };
    }
  }

  // Capture previous event image paths so we can sweep only the removed
  // Storage objects after the Firestore write succeeds. Order matters:
  // write first, cleanup after (pattern from PR #24), so a failed doc
  // update never deletes files the live doc still references.
  const nextImagePaths = uniqueStoragePaths([
    parsed.coverImage?.path,
    ...parsed.subImages.map((image) => image.path),
  ]);
  const orphanPaths = eventImagePaths(cur).filter(
    (path) => !nextImagePaths.includes(path),
  );

  await ref.update({
    ...(requestedSlug ? { slug: requestedSlug } : {}),
    title: parsed.title,
    description: parsed.description,
    startAt: Timestamp.fromDate(dateTimes.startAt),
    endAt: Timestamp.fromDate(dateTimes.endAt),
    timeZone: parsed.timeZone,
    location: {
      type: parsed.locationType,
      address: parsed.address ?? "",
      mapUrl: parsed.mapUrl || "",
      meetingUrl: parsed.meetingUrl || "",
    },
    capacity: parsed.capacity,
    presenterCapacity: parsed.presenterCapacity,
    status: parsed.status,
    visibility: parsed.visibility ?? "public",
    checkInEarlyMinutes:
      parsed.checkInEarlyMinutes ?? DEFAULT_CHECKIN_EARLY_MINUTES,
    checkInLateMinutes:
      parsed.checkInLateMinutes ?? DEFAULT_CHECKIN_LATE_MINUTES,
    coverImage: parsed.coverImage ?? FieldValue.delete(),
    subImages: parsed.subImages,
    // Drop the legacy `coverImagePath` field so existing docs normalize
    // to the new shape on first edit (same pattern as PR #24).
    coverImagePath: FieldValue.delete(),
    surveyFields: parsed.surveyFields,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (orphanPaths.length > 0) await deleteStoragePaths(orphanPaths);

  // Expire the cached / + /events lists (src/lib/data/cached.ts) in both locales.
  updateTag(EVENTS_TAG);
  revalidatePath("/events");
  revalidatePath("/admin/events");
  return { ok: true };
}

export async function deleteEvent(eventId: string): Promise<void> {
  await requireAdmin();
  const ref = adminDb().collection("events").doc(eventId);
  const snap = await ref.get();
  const cur = snap.exists ? (snap.data() as EventDoc) : null;

  // Delete the doc first so a transient Storage failure doesn't leave the
  // doc alive but referencing a missing file (same delete-doc-first
  // pattern as projects + posts).
  await ref.delete();
  if (cur) await deleteStoragePaths(eventImagePaths(cur));
  // Expire the cached / + /events lists (src/lib/data/cached.ts) in both locales.
  updateTag(EVENTS_TAG);
  revalidatePath("/events");
  revalidatePath("/admin/events");
  // Redirect server-side instead of letting the client navigate after the
  // action resolves. Without this, the just-completed action triggers a
  // refresh of the CURRENT route (`/admin/events/[id]/edit`), whose page
  // re-runs `getEventById` → the doc is gone → `notFound()`, so the admin
  // sees the 404 page flash before the client-side redirect lands. A
  // server redirect navigates straight to the list and never re-renders
  // the deleted event's edit page.
  return redirectToLocalizedPath("/admin/events");
}

export async function cloneEvent(
  originalId: string,
): Promise<EventSaveResult> {
  const admin = await requireAdmin();
  const srcRef = adminDb().collection("events").doc(originalId);
  const srcSnap = await srcRef.get();
  if (!srcSnap.exists) {
    return { ok: false, error: await actionError("cloneSourceEventNotFound") };
  }
  // Existing docs predate some of the optional fields here (visibility,
  // surveyFields, etc), so all of them get explicit defaults below before
  // we write the clone. ignoreUndefinedProperties handles undefined at the
  // Firestore level, but defaulting also keeps the doc shape predictable.
  const src = srcSnap.data() as {
    slug?: string;
    title: string;
    description: string;
    startAt: Timestamp;
    endAt: Timestamp;
    timeZone?: string;
    location: {
      type: "online" | "offline" | "hybrid";
      address?: string;
      mapUrl?: string;
      meetingUrl?: string;
    };
    capacity?: number;
    presenterCapacity?: number;
    surveyFields?: unknown[];
    visibility?: "public" | "members_only";
  };

  // Shift the copy a week ahead and preserve the original duration so a
  // 30-min lightning talk clones into a 30-min slot, a 90-min meetup
  // stays 90 minutes, etc. If the source's duration is non-positive (data
  // corruption / hand-edited doc), fall back to 1 hour rather than
  // creating an inverted or zero-length range.
  const rawDuration = src.endAt.toMillis() - src.startAt.toMillis();
  const duration = rawDuration > 0 ? rawDuration : 60 * 60 * 1000;
  const newStart = Timestamp.fromMillis(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  );
  const newEnd = Timestamp.fromMillis(newStart.toMillis() + duration);

  // Base the new slug on the source slug (when it exists) so a localized
  // title that does not slugify cleanly carries the original's clean
  // English slug forward as `jtpa-salon-32-1`, instead of collapsing into
  // a generic timestamp via slugify of the title.
  const slug = await findUniqueSlug("events", src.slug || src.title);

  const now = Timestamp.now();
  // Subcollections (rsvps, presentations) are NOT copied — they belong to
  // the original event. The new clone starts fresh.
  const newRef = await adminDb().collection("events").add({
    slug,
    title: `${src.title} ${defaultActionError("copySuffix")}`,
    description: src.description,
    startAt: newStart,
    endAt: newEnd,
    timeZone: eventTimeZone(src),
    location: src.location,
    capacity: src.capacity ?? 0,
    presenterCapacity: src.presenterCapacity ?? 0,
    status: "draft" as const,
    visibility: src.visibility ?? "public",
    surveyFields: src.surveyFields ?? [],
    rsvpCount: 0,
    presenterCount: 0,
    waitlistCount: 0,
    createdBy: admin.uid,
    createdAt: now,
    updatedAt: now,
  });

  revalidatePath("/admin/events");
  return redirectToLocalizedPath(`/admin/events/${newRef.id}/edit`);
}
