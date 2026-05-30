"use server";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireAdmin, requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import { actionError, inputError } from "@/lib/i18n/action-errors";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import type { QaDoc, QaStatus } from "@/lib/types";
import { slugify } from "@/lib/utils";

// Same shape Firestore auto-ids use; QaForm pre-generates one via
// `doc(collection(clientDb, "qa")).id` so it can upload images to
// `qa/{qaId}/...` before the doc itself is saved. Validating it
// against the same regex Firestore uses on auto-ids (20 chars, no
// special punctuation) keeps anything weirder out of doc().set().
const FIRESTORE_AUTO_ID = /^[A-Za-z0-9_-]{1,40}$/;
const QA_INVALID_ID = "qaInvalidId";

const QaFormSchema = z.object({
  // Pre-generated client-side id. When present, `submitQa` writes the
  // doc at exactly that id so images uploaded under `qa/{id}/...` line
  // up with the Firestore doc. Optional so future non-image callers
  // can still hit the action without owning an id ahead of time.
  id: z
    .string()
    .regex(FIRESTORE_AUTO_ID, QA_INVALID_ID)
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

// Mutations return a result rather than throwing so the real reason
// reaches the user — Next masks thrown Server Action errors as a generic
// digest in production (same pattern as users/events/rsvps/presentations).
// The create/update/delete paths redirect on success, so they only ever
// *return* on failure; setQaStatus returns { ok: true }.
export type QaActionResult = { ok: true } | { ok: false; error: string };

async function parseOrError<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; error: string }> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const issues = await Promise.all(
    result.error.issues.map(async (issue) => ({
      path: issue.path,
      message:
        issue.message === QA_INVALID_ID
          ? await actionError("qaInvalidId")
          : issue.message,
    })),
  );
  return { ok: false, error: await inputError(issues) };
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

export async function submitQa(input: QaFormInput): Promise<QaActionResult> {
  const user = await requireUser();
  const pr = await parseOrError(QaFormSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

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
      const code = (err as { code?: number | string } | null)?.code;
      if (code === 6 || code === "already-exists") {
        return { ok: false, error: await actionError("qaSaveRetry") };
      }
      throw err;
    }
  } else {
    await collectionRef.add(payload);
  }

  revalidatePath("/qa");
  revalidatePath(`/qa/${slug}`);
  return redirectToLocalizedPath(`/qa/${slug}`);
}

export async function updateMyQa(
  qaId: string,
  input: QaFormInput,
): Promise<QaActionResult> {
  const user = await requireUser();
  const pr = await parseOrError(QaFormSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

  const ref = adminDb().collection("qa").doc(qaId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("qaNotFound") };
  const cur = snap.data() as QaDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    return { ok: false, error: await actionError("qaEditForbidden") };
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
  return redirectToLocalizedPath(`/qa/${newSlug}`);
}

export async function deleteMyQa(qaId: string): Promise<QaActionResult> {
  const user = await requireUser();
  const ref = adminDb().collection("qa").doc(qaId);
  const snap = await ref.get();
  if (snap.exists) {
    const cur = snap.data() as QaDoc;
    if (cur.authorUid !== user.uid && !user.isAdmin) {
      return { ok: false, error: await actionError("qaDeleteForbidden") };
    }
    // We don't recursively delete the comments/likes subcollections here —
    // Firestore doesn't cascade. Admin can do that out-of-band if a Q&A
    // is being deleted for moderation reasons; in practice the parent
    // doc going away makes the subcollection unreachable anyway.
    await ref.delete();
    revalidatePath("/qa");
    revalidatePath(`/qa/${cur.slug}`);
  }
  return redirectToLocalizedPath("/qa");
}

/**
 * Admin-only: flip a Q&A's status between "published" and "archived".
 * Archived items disappear from public listings + detail but the author
 * still sees them on `/my/qa` so they know why their post went dark.
 */
export async function setQaStatus(
  input: SetQaStatusInput,
): Promise<QaActionResult> {
  await requireAdmin();
  const pr = await parseOrError(StatusSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;

  const ref = adminDb().collection("qa").doc(parsed.qaId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("qaNotFound") };
  const cur = snap.data() as QaDoc;

  if (cur.status === parsed.status) return { ok: true }; // no-op
  await ref.update({
    status: parsed.status as QaStatus,
    updatedAt: Timestamp.now(),
  });

  revalidatePath("/qa");
  revalidatePath(`/qa/${cur.slug}`);
  return { ok: true };
}
