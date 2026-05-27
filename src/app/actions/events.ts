"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import { slugify } from "@/lib/utils";

const SurveyFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "select", "checkbox"]),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  audience: z.enum(["all", "presenter"]),
});

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
  surveyFields: z.array(SurveyFieldSchema).default([]),
});

export type EventFormInput = z.input<typeof EventInputSchema>;

function parseEventInput(input: EventFormInput): z.infer<typeof EventInputSchema> {
  const result = EventInputSchema.safeParse(input);
  if (result.success) return result.data;
  // Surface a readable error so the user sees which field failed instead of
  // the generic Server Component crash.
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

export async function createEvent(input: EventFormInput): Promise<string> {
  const admin = await requireAdmin();
  const parsed = parseEventInput(input);

  const slug = parsed.slug || slugify(parsed.title);
  // Ensure slug uniqueness
  const existing = await adminDb()
    .collection("events")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new Error(`スラッグ "${slug}" は既に使用されています`);
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
  redirect(`/admin/events/${ref.id}/edit`);
}

export async function updateEvent(
  eventId: string,
  input: EventFormInput,
): Promise<void> {
  await requireAdmin();
  const parsed = parseEventInput(input);
  const ref = adminDb().collection("events").doc(eventId);

  if (parsed.slug) {
    const conflict = await adminDb()
      .collection("events")
      .where("slug", "==", parsed.slug)
      .limit(2)
      .get();
    if (conflict.docs.some((d) => d.id !== eventId)) {
      throw new Error(`スラッグ "${parsed.slug}" は既に使用されています`);
    }
  }

  await ref.update({
    ...(parsed.slug ? { slug: parsed.slug } : {}),
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
    surveyFields: parsed.surveyFields,
    updatedAt: FieldValue.serverTimestamp(),
  });

  revalidatePath("/events");
  revalidatePath("/admin/events");
}

export async function deleteEvent(eventId: string): Promise<void> {
  await requireAdmin();
  await adminDb().collection("events").doc(eventId).delete();
  revalidatePath("/events");
  revalidatePath("/admin/events");
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

export async function cloneEvent(originalId: string): Promise<void> {
  const admin = await requireAdmin();
  const srcRef = adminDb().collection("events").doc(originalId);
  const srcSnap = await srcRef.get();
  if (!srcSnap.exists) throw new Error("NOT_FOUND");
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

  // Base the new slug on the source slug (when it exists) so a Japanese-
  // only title like "第32回 JTPAサロン" carries the original's clean
  // English slug forward as `jtpa-salon-32-1`, instead of collapsing into
  // a generic timestamp via slugify of the title.
  const slug = await findFreeSlug(src.slug || src.title);

  const now = Timestamp.now();
  // Subcollections (rsvps, presentations) are NOT copied — they belong to
  // the original event. The new clone starts fresh.
  const newRef = await adminDb().collection("events").add({
    slug,
    title: `${src.title} (コピー)`,
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
  redirect(`/admin/events/${newRef.id}/edit`);
}
