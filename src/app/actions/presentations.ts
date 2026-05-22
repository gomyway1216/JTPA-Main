"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { plainify } from "@/lib/data/serialize";
import { requireUser } from "@/lib/auth/session";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import type { PresentationDoc, RsvpDoc } from "@/lib/types";

// Either a file (filePath + fileUrl) or an external URL must be present.
const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional(),
);

const SavePresentationSchema = z
  .object({
    eventId: z.string().min(1),
    eventSlug: z.string().min(1),
    filePath: z.string().optional(),
    fileUrl: z.string().optional(),
    fileName: z.string().optional(),
    externalSlidesUrl: optionalUrl,
  })
  .refine(
    (v) => !!v.externalSlidesUrl || (!!v.filePath && !!v.fileUrl),
    "ファイル または 外部URL のどちらかを指定してください",
  );

export type SavePresentationInput = z.input<typeof SavePresentationSchema>;

function parse(input: SavePresentationInput) {
  const result = SavePresentationSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

export async function savePresentation(
  input: SavePresentationInput,
): Promise<PresentationDoc> {
  const user = await requireUser();
  const parsed = parse(input);

  // Verify the caller has a confirmed presenter RSVP for this event. We pull
  // title/abstract straight from the RSVP so the presenter doesn't re-type
  // them, and so we can't accept "phantom" presentations from non-presenters.
  const rsvpSnap = await adminDb()
    .collection("events")
    .doc(parsed.eventId)
    .collection("rsvps")
    .doc(user.uid)
    .get();
  if (!rsvpSnap.exists) throw new Error("発表者として登録されていません");
  const rsvp = rsvpSnap.data() as RsvpDoc;
  if (rsvp.role !== "presenter" || rsvp.status !== "confirmed") {
    throw new Error("発表者として登録されていません");
  }

  const presentationRef = adminDb()
    .collection("events")
    .doc(parsed.eventId)
    .collection("presentations")
    .doc(user.uid);
  const existingSnap = await presentationRef.get();
  const now = Timestamp.now();

  // If replacing an existing file upload with a new one (or with an external
  // URL), delete the previous Storage object so we don't accumulate dead
  // bytes. Best-effort — log and continue on failure.
  if (existingSnap.exists) {
    const prev = existingSnap.data() as PresentationDoc;
    const prevPath = prev.filePath;
    if (prevPath && prevPath !== parsed.filePath) {
      try {
        await adminStorage().bucket().file(prevPath).delete();
      } catch (err) {
        console.warn("Failed to delete previous presentation file:", err);
      }
    }
  }

  const doc: Omit<PresentationDoc, "id"> = {
    eventId: parsed.eventId,
    presenterUid: user.uid,
    presenterName: user.displayName,
    title: rsvp.presentationTitle ?? "",
    abstract: rsvp.presentationAbstract,
    filePath: parsed.filePath,
    fileUrl: parsed.fileUrl,
    externalSlidesUrl: parsed.externalSlidesUrl,
    createdAt: existingSnap.exists
      ? ((existingSnap.data() as PresentationDoc).createdAt as Timestamp)
      : now,
    updatedAt: now,
  };
  await presentationRef.set(doc, { merge: false });

  revalidatePath(`/events/${parsed.eventSlug}`);
  return plainify({ ...doc, id: presentationRef.id });
}

export async function deletePresentation(args: {
  eventId: string;
  eventSlug: string;
}): Promise<void> {
  const user = await requireUser();
  const ref = adminDb()
    .collection("events")
    .doc(args.eventId)
    .collection("presentations")
    .doc(user.uid);
  const snap = await ref.get();
  if (!snap.exists) return;

  const data = snap.data() as PresentationDoc;
  if (data.filePath) {
    try {
      await adminStorage().bucket().file(data.filePath).delete();
    } catch (err) {
      // File may already be gone, or storage perms changed — let the doc
      // delete proceed so the UI isn't stuck.
      console.warn("Failed to delete presentation file:", err);
    }
  }
  await ref.delete();

  // Touch the event so revalidate / cache invalidation cascades, in case we
  // later denormalize a presenterCount or similar.
  await adminDb()
    .collection("events")
    .doc(args.eventId)
    .update({ updatedAt: FieldValue.serverTimestamp() });

  revalidatePath(`/events/${args.eventSlug}`);
}
