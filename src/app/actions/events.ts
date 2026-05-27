"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import { requireAdmin } from "@/lib/auth/session";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
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
  coverImage: AssetSchema.optional(),
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
  redirect(`/admin/events/${ref.id}/edit`);
}

export async function updateEvent(
  eventId: string,
  input: EventFormInput,
): Promise<void> {
  await requireAdmin();
  const parsed = parseEventInput(input);
  const ref = adminDb().collection("events").doc(eventId);
  const snap = await ref.get();
  const cur = snap.exists ? (snap.data() as EventDoc) : null;

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

  // Capture the previous cover image path so we can sweep it after the
  // Firestore write succeeds. Order matters — write first, cleanup after
  // (pattern from PR #24): if the doc update fails, we don't want to have
  // already deleted the file the doc still points to.
  const orphan =
    cur?.coverImage &&
    cur.coverImage.path !== parsed.coverImage?.path
      ? cur.coverImage.path
      : null;

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
}
