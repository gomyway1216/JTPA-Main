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

const EventInputSchema = z.object({
  title: z.string().min(2).max(200),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().min(1).max(20000),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  locationType: z.enum(["online", "offline", "hybrid"]),
  address: z.string().optional(),
  mapUrl: z.string().url().optional().or(z.literal("")),
  meetingUrl: z.string().url().optional().or(z.literal("")),
  capacity: z.coerce.number().int().min(0),
  presenterCapacity: z.coerce.number().int().min(0),
  status: z.enum(["draft", "published", "past", "cancelled"]),
  surveyFields: z.array(SurveyFieldSchema).default([]),
});

export type EventFormInput = z.input<typeof EventInputSchema>;

export async function createEvent(input: EventFormInput): Promise<string> {
  const admin = await requireAdmin();
  const parsed = EventInputSchema.parse(input);

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
  const parsed = EventInputSchema.parse(input);
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
