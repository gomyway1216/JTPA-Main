"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import {
  actionError,
  defaultActionError,
  inputError,
} from "@/lib/i18n/action-errors";
import {
  DEFAULT_CHECKIN_EARLY_MINUTES,
  DEFAULT_CHECKIN_LATE_MINUTES,
  MAX_CHECKIN_WINDOW_MINUTES,
} from "@/lib/check-in";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
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

async function deleteStoragePaths(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const bucket = adminStorage().bucket();
  await Promise.all(
    paths.map((p) =>
      bucket
        .file(p)
        .delete()
        .catch((err) => {
          console.warn("Failed to delete storage object:", p, err);
        }),
    ),
  );
}

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
  surveyFields: z.array(SurveyFieldSchema).default([]),
});

export type EventFormInput = z.input<typeof EventInputSchema>;

// createEvent / cloneEvent redirect on success (so they only ever *return*
// on failure); updateEvent returns { ok: true }. Returning the error rather
// than throwing it is what lets the real message reach the admin — Next
// masks thrown Server Action errors as a generic digest in production (same
// reasoning as users.ts / presentations.ts, per PR #59).
export type EventSaveResult = { ok: true } | { ok: false; error: string };

type ParsedEventInput =
  | { ok: true; data: z.infer<typeof EventInputSchema> }
  | { ok: false; error: string };

async function parseEventInput(input: EventFormInput): Promise<ParsedEventInput> {
  const result = EventInputSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  // Readable error so the admin sees which field failed instead of the
  // generic Server Component crash.
  return { ok: false, error: await inputError(result.error.issues) };
}

export async function createEvent(
  input: EventFormInput,
): Promise<EventSaveResult> {
  const admin = await requireAdmin();
  const pr = await parseEventInput(input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

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
    startAt: Timestamp.fromDate(new Date(parsed.startAt)),
    endAt: Timestamp.fromDate(new Date(parsed.endAt)),
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
    surveyFields: parsed.surveyFields,
    rsvpCount: 0,
    presenterCount: 0,
    waitlistCount: 0,
    createdBy: admin.uid,
    createdAt: now,
    updatedAt: now,
  });

  revalidatePath("/events");
  revalidatePath("/admin/events");
  return redirectToLocalizedPath(`/admin/events/${ref.id}/edit`);
}

export async function updateEvent(
  eventId: string,
  input: EventFormInput,
): Promise<EventSaveResult> {
  await requireAdmin();
  const pr = await parseEventInput(input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
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

  // Capture the previous cover image path so we can sweep it after the
  // Firestore write succeeds. Order matters — write first, cleanup after
  // (pattern from PR #24): if the doc update fails, we don't want to have
  // already deleted the file the doc still points to.
  const orphan =
    cur.coverImage &&
    cur.coverImage.path !== parsed.coverImage?.path
      ? cur.coverImage.path
      : null;

  await ref.update({
    ...(requestedSlug ? { slug: requestedSlug } : {}),
    title: parsed.title,
    description: parsed.description,
    startAt: Timestamp.fromDate(new Date(parsed.startAt)),
    endAt: Timestamp.fromDate(new Date(parsed.endAt)),
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
    // Drop the legacy `coverImagePath` field so existing docs normalize
    // to the new shape on first edit (same pattern as PR #24).
    coverImagePath: FieldValue.delete(),
    surveyFields: parsed.surveyFields,
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (orphan) await deleteStoragePaths([orphan]);

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
  if (cur?.coverImage) {
    await deleteStoragePaths([cur.coverImage.path]);
  }
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

// Try the base slug first, then append `-1`, `-2`, ... until we find one
// that's free. Returns a base36-timestamp fallback if we hit 20 collisions.
// Mirrors the helper in `src/app/actions/projects.ts` (kept inline so this
// file doesn't reach across module boundaries for a 12-line utility).
async function findFreeSlug(base: string): Promise<string> {
  const seed = slugify(base);
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? seed : `${seed}-${i}`;
    const snap = await adminDb()
      .collection("events")
      .where("slug", "==", candidate)
      .limit(1)
      .get();
    if (snap.empty) return candidate;
  }
  return `${seed}-${Date.now().toString(36)}`;
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
  const slug = await findFreeSlug(src.slug || src.title);

  const now = Timestamp.now();
  // Subcollections (rsvps, presentations) are NOT copied — they belong to
  // the original event. The new clone starts fresh.
  const newRef = await adminDb().collection("events").add({
    slug,
    title: `${src.title} ${defaultActionError("copySuffix")}`,
    description: src.description,
    startAt: newStart,
    endAt: newEnd,
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
