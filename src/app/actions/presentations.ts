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

// Mutations return a discriminated result rather than throwing. Next.js
// masks thrown Server Action error messages as the generic "An error
// occurred in the Server Components render" digest in production, so a
// thrown validation/permission message never reaches the presenter — they
// just see an opaque crash and "can't proceed" when adding slides
// (issue #103). Returning the message lets the form render it. Same
// pattern as src/app/actions/users.ts (per PR #59 Gemini review).
export type PresentationResult =
  | { ok: true; presentation: PresentationDoc }
  | { ok: false; error: string };

// Zod parse that yields a readable error string instead of throwing, so
// the message survives to the client (see PresentationResult above).
function parseOrError<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: `入力エラー: ${issues}` };
}

async function ensurePresenter(
  eventId: string,
  uid: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const denied = {
    ok: false as const,
    error: "発表者として登録されていません",
  };
  const rsvpSnap = await adminDb()
    .collection("events")
    .doc(eventId)
    .collection("rsvps")
    .doc(uid)
    .get();
  if (!rsvpSnap.exists) return denied;
  const rsvp = rsvpSnap.data() as RsvpDoc;
  if (rsvp.role !== "presenter" || rsvp.status !== "confirmed") {
    return denied;
  }
  return { ok: true };
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
): Promise<PresentationResult> {
  const user = await requireUser();
  const parsed = parseOrError(CreateSchema, input);
  if (!parsed.ok) return parsed;
  const presenter = await ensurePresenter(parsed.data.eventId, user.uid);
  if (!presenter.ok) return presenter;

  const now = Timestamp.now();
  const ref = adminDb()
    .collection("events")
    .doc(parsed.data.eventId)
    .collection("presentations")
    .doc(); // auto-id → multiple presentations per presenter

  const doc: Omit<PresentationDoc, "id"> = {
    eventId: parsed.data.eventId,
    presenterUid: user.uid,
    presenterName: user.displayName,
    title: parsed.data.title,
    abstract: parsed.data.abstract,
    filePath: parsed.data.filePath,
    fileUrl: parsed.data.fileUrl,
    fileName: parsed.data.fileName,
    externalSlidesUrl: parsed.data.externalSlidesUrl,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);

  revalidatePath(`/events/${parsed.data.eventSlug}`);
  return { ok: true, presentation: plainify({ ...doc, id: ref.id }) };
}

export async function updatePresentation(
  input: UpdatePresentationInput,
): Promise<PresentationResult> {
  const user = await requireUser();
  const parsed = parseOrError(UpdateSchema, input);
  if (!parsed.ok) return parsed;

  const ref = adminDb()
    .collection("events")
    .doc(parsed.data.eventId)
    .collection("presentations")
    .doc(parsed.data.presentationId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, error: "発表資料が見つかりません" };
  }
  const prev = snap.data() as PresentationDoc;
  if (prev.presenterUid !== user.uid) {
    return { ok: false, error: "この発表資料を編集する権限がありません" };
  }

  // If the caller replaced an uploaded file (different filePath, or
  // switched to URL-only), drop the previous Storage object so we don't
  // leak bytes.
  if (prev.filePath && prev.filePath !== parsed.data.filePath) {
    await deleteStorageFile(prev.filePath);
  }

  const patch: Omit<PresentationDoc, "id" | "createdAt"> = {
    eventId: parsed.data.eventId,
    presenterUid: prev.presenterUid,
    presenterName: prev.presenterName,
    title: parsed.data.title,
    abstract: parsed.data.abstract,
    filePath: parsed.data.filePath,
    fileUrl: parsed.data.fileUrl,
    fileName: parsed.data.fileName,
    externalSlidesUrl: parsed.data.externalSlidesUrl,
    updatedAt: Timestamp.now(),
  };
  await ref.set(patch, { merge: true });

  revalidatePath(`/events/${parsed.data.eventSlug}`);
  return {
    ok: true,
    presentation: plainify({ ...patch, id: ref.id, createdAt: prev.createdAt }),
  };
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
