"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { plainify } from "@/lib/data/serialize";
import { requireUser } from "@/lib/auth/session";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import type { PresentationDoc, RsvpDoc } from "@/lib/types";

const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional(),
);

// A presentation needs a title plus at least one of (uploaded file, external
// URL). Both can co-exist — e.g. PDF slides + a recording link.
const CorePresentationFields = {
  title: z.string().min(1).max(200),
  abstract: z.string().max(5000).optional(),
  filePath: z.string().optional(),
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  externalSlidesUrl: optionalUrl,
};

const CreateSchema = z
  .object({
    eventId: z.string().min(1),
    eventSlug: z.string().min(1),
    ...CorePresentationFields,
  })
  .refine(
    (v) => !!v.externalSlidesUrl || (!!v.filePath && !!v.fileUrl),
    "ファイル または 外部URL のどちらかを指定してください",
  );

const UpdateSchema = z
  .object({
    presentationId: z.string().min(1),
    eventId: z.string().min(1),
    eventSlug: z.string().min(1),
    ...CorePresentationFields,
  })
  .refine(
    (v) => !!v.externalSlidesUrl || (!!v.filePath && !!v.fileUrl),
    "ファイル または 外部URL のどちらかを指定してください",
  );

export type CreatePresentationInput = z.input<typeof CreateSchema>;
export type UpdatePresentationInput = z.input<typeof UpdateSchema>;

function readableParse<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

async function ensurePresenter(eventId: string, uid: string): Promise<void> {
  const rsvpSnap = await adminDb()
    .collection("events")
    .doc(eventId)
    .collection("rsvps")
    .doc(uid)
    .get();
  if (!rsvpSnap.exists) throw new Error("発表者として登録されていません");
  const rsvp = rsvpSnap.data() as RsvpDoc;
  if (rsvp.role !== "presenter" || rsvp.status !== "confirmed") {
    throw new Error("発表者として登録されていません");
  }
}

async function deleteStorageFile(path: string): Promise<void> {
  try {
    await adminStorage().bucket().file(path).delete();
  } catch (err) {
    // File may already be gone, or perms changed. Don't block the metadata
    // write — just log.
    console.warn("Failed to delete presentation file:", path, err);
  }
}

export async function createPresentation(
  input: CreatePresentationInput,
): Promise<PresentationDoc> {
  const user = await requireUser();
  const parsed = readableParse(CreateSchema, input);
  await ensurePresenter(parsed.eventId, user.uid);

  const now = Timestamp.now();
  const ref = adminDb()
    .collection("events")
    .doc(parsed.eventId)
    .collection("presentations")
    .doc(); // auto-id → multiple presentations per presenter

  const doc: Omit<PresentationDoc, "id"> = {
    eventId: parsed.eventId,
    presenterUid: user.uid,
    presenterName: user.displayName,
    title: parsed.title,
    abstract: parsed.abstract,
    filePath: parsed.filePath,
    fileUrl: parsed.fileUrl,
    fileName: parsed.fileName,
    externalSlidesUrl: parsed.externalSlidesUrl,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);

  revalidatePath(`/events/${parsed.eventSlug}`);
  return plainify({ ...doc, id: ref.id });
}

export async function updatePresentation(
  input: UpdatePresentationInput,
): Promise<PresentationDoc> {
  const user = await requireUser();
  const parsed = readableParse(UpdateSchema, input);

  const ref = adminDb()
    .collection("events")
    .doc(parsed.eventId)
    .collection("presentations")
    .doc(parsed.presentationId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("発表資料が見つかりません");
  const prev = snap.data() as PresentationDoc;
  if (prev.presenterUid !== user.uid) throw new Error("FORBIDDEN");

  // If the caller replaced an uploaded file (different filePath, or
  // switched to URL-only), drop the previous Storage object so we don't
  // leak bytes.
  if (prev.filePath && prev.filePath !== parsed.filePath) {
    await deleteStorageFile(prev.filePath);
  }

  const patch: Omit<PresentationDoc, "id" | "createdAt"> = {
    eventId: parsed.eventId,
    presenterUid: prev.presenterUid,
    presenterName: prev.presenterName,
    title: parsed.title,
    abstract: parsed.abstract,
    filePath: parsed.filePath,
    fileUrl: parsed.fileUrl,
    fileName: parsed.fileName,
    externalSlidesUrl: parsed.externalSlidesUrl,
    updatedAt: Timestamp.now(),
  };
  await ref.set(patch, { merge: true });

  revalidatePath(`/events/${parsed.eventSlug}`);
  return plainify({ ...patch, id: ref.id, createdAt: prev.createdAt });
}

export async function deletePresentation(args: {
  presentationId: string;
  eventId: string;
  eventSlug: string;
}): Promise<void> {
  const user = await requireUser();
  const ref = adminDb()
    .collection("events")
    .doc(args.eventId)
    .collection("presentations")
    .doc(args.presentationId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data() as PresentationDoc;
  if (data.presenterUid !== user.uid) throw new Error("FORBIDDEN");

  if (data.filePath) {
    await deleteStorageFile(data.filePath);
  }
  await ref.delete();

  // Touch the event so downstream caches invalidate even if we later add
  // a denormalized presentation count.
  await adminDb()
    .collection("events")
    .doc(args.eventId)
    .update({ updatedAt: FieldValue.serverTimestamp() });

  revalidatePath(`/events/${args.eventSlug}`);
}
