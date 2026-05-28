"use server";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import { requireAdmin, requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type { QaDoc, QaStatus } from "@/lib/types";
import { slugify } from "@/lib/utils";

// Same shape Firestore auto-ids use; QaForm pre-generates one via
// `doc(collection(clientDb, "qa")).id` so it can upload images to
// `qa/{qaId}/...` before the doc itself is saved. Validating it
// against the same regex Firestore uses on auto-ids (20 chars, no
// special punctuation) keeps anything weirder out of doc().set().
const FIRESTORE_AUTO_ID = /^[A-Za-z0-9_-]{1,40}$/;

const QaFormSchema = z.object({
  // Pre-generated client-side id. When present, `submitQa` writes the
  // doc at exactly that id so images uploaded under `qa/{id}/...` line
  // up with the Firestore doc. Optional so future non-image callers
  // can still hit the action without owning an id ahead of time.
  id: z
    .string()
    .regex(FIRESTORE_AUTO_ID, "不正なIDが指定されました")
    .optional(),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(20000),
  // Tags arrive as a CSV from the form; the action normalizes them. Cap
  // at 8 to discourage tag spam and keep the listing UI sane.
  tags: z
    .array(z.string().trim().min(1).max(40))
    .max(8)
    .optional()
    .default([]),
  slug: z.string().trim().min(2).max(80).optional(),
});

export type QaFormInput = z.input<typeof QaFormSchema>;

const StatusSchema = z.object({
  qaId: z.string().min(1),
  status: z.enum(["published", "archived"]),
});

export type SetQaStatusInput = z.input<typeof StatusSchema>;

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

// Resolve a free slug under /qa. Mirrors the pattern in
// `src/app/actions/events.ts` — try a base slug, then append a base36
// timestamp if it's already taken. Capped to keep the loop bounded.
async function findFreeQaSlug(seed: string): Promise<string> {
  const base = slugify(seed, "qa");
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${Date.now().toString(36)}`;
    const snap = await adminDb()
      .collection("qa")
      .where("slug", "==", candidate)
      .limit(1)
      .get();
    if (snap.empty) return candidate;
  }
  // Pathological case (extremely fast same-ms collisions); fall back to
  // a fully random suffix so we never spin forever.
  return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function submitQa(input: QaFormInput): Promise<string> {
  const user = await requireUser();
  const parsed = readableParse(QaFormSchema, input);

  const slug = await findFreeQaSlug(parsed.slug || parsed.title);
  const now = Timestamp.now();

  // No moderation queue — questions go straight to "published". Admins
  // can flip to "archived" later if something is spam/abuse.
  const payload: Omit<QaDoc, "id"> = {
    slug,
    title: parsed.title,
    body: parsed.body,
    tags: parsed.tags,
    authorUid: user.uid,
    authorName: user.displayName,
    authorPhotoURL: user.photoURL,
    status: "published",
    likeCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  // Honor the client-supplied id when present so image uploads under
  // `qa/{id}/...` resolve to the actual Firestore doc later. `create()`
  // is atomic (fails with ALREADY_EXISTS on collision) so we avoid the
  // read-then-write race a `get()` + `set()` would have. Falling back
  // to a fresh `doc()` is fine — that's the no-image-upload path where
  // there's nothing in Storage to be orphaned by a different id.
  const collectionRef = adminDb().collection("qa");
  if (parsed.id) {
    const ref = collectionRef.doc(parsed.id);
    try {
      await ref.create(payload);
    } catch (err) {
      // ALREADY_EXISTS — extremely unlikely (Firestore auto-id space is
      // huge) but possible if a client retries the submit. Treat it the
      // same as a slug collision and surface a useful error.
      const code = (err as { code?: number | string }).code;
      if (code === 6 || code === "already-exists") {
        throw new Error("投稿の保存に失敗しました。もう一度やり直してください。");
      }
      throw err;
    }
  } else {
    await collectionRef.add(payload);
  }

  revalidatePath("/qa");
  revalidatePath(`/qa/${slug}`);
  redirect(`/qa/${slug}`);
}

export async function updateMyQa(
  qaId: string,
  input: QaFormInput,
): Promise<void> {
  const user = await requireUser();
  const parsed = readableParse(QaFormSchema, input);

  const ref = adminDb().collection("qa").doc(qaId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as QaDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    throw new Error("FORBIDDEN");
  }

  // Slug changes only when the author explicitly chose a new value AND
  // it differs from the existing one. Keeping the existing slug stable
  // by default means existing inbound links don't break on every edit.
  let newSlug = cur.slug;
  if (parsed.slug && parsed.slug !== cur.slug) {
    newSlug = await findFreeQaSlug(parsed.slug);
  }

  await ref.update({
    slug: newSlug,
    title: parsed.title,
    body: parsed.body,
    tags: parsed.tags,
    updatedAt: Timestamp.now(),
  });

  revalidatePath("/qa");
  revalidatePath(`/qa/${cur.slug}`);
  if (newSlug !== cur.slug) revalidatePath(`/qa/${newSlug}`);
  redirect(`/qa/${newSlug}`);
}

export async function deleteMyQa(qaId: string): Promise<void> {
  const user = await requireUser();
  const ref = adminDb().collection("qa").doc(qaId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as QaDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    throw new Error("FORBIDDEN");
  }
  // We don't recursively delete the comments/likes subcollections here —
  // Firestore doesn't cascade. Admin can do that out-of-band if a Q&A
  // is being deleted for moderation reasons; in practice the parent
  // doc going away makes the subcollection unreachable anyway.
  await ref.delete();
  revalidatePath("/qa");
  revalidatePath(`/qa/${cur.slug}`);
  redirect("/qa");
}

/**
 * Admin-only: flip a Q&A's status between "published" and "archived".
 * Archived items disappear from public listings + detail but the author
 * still sees them on `/my/qa` so they know why their post went dark.
 */
export async function setQaStatus(input: SetQaStatusInput): Promise<void> {
  await requireAdmin();
  const parsed = readableParse(StatusSchema, input);

  const ref = adminDb().collection("qa").doc(parsed.qaId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as QaDoc;

  if (cur.status === parsed.status) return; // no-op
  await ref.update({
    status: parsed.status as QaStatus,
    updatedAt: Timestamp.now(),
  });

  revalidatePath("/qa");
  revalidatePath(`/qa/${cur.slug}`);
}
