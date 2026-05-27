"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import { requireEditor } from "@/lib/auth/session";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import type { GuideAuthorRef } from "@/lib/types";
import { slugify } from "@/lib/utils";

// Firestore auto-IDs are 20 alphanumeric chars; we accept the same shape
// from the client when a draft id is supplied so we can co-locate
// pre-save image uploads under the eventual doc's path.
const FIRESTORE_AUTO_ID = /^[A-Za-z0-9]{20}$/;

const optionalNonEmpty = (schema: z.ZodTypeAny) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const GuideInputSchema = z.object({
  title: z.string().min(2).max(200),
  slug: optionalNonEmpty(z.string().min(2).max(80).regex(/^[a-z0-9-]+$/)),
  body: z.string().min(1).max(50000),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  status: z.enum(["draft", "published"]),
  order: z.coerce.number().int().min(0).max(99999).default(100),
});

export type GuideFormInput = z.input<typeof GuideInputSchema>;

function parseGuideInput(
  input: GuideFormInput,
): z.infer<typeof GuideInputSchema> {
  const result = GuideInputSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

function authorRef(user: {
  uid: string;
  displayName: string;
  email: string;
}): GuideAuthorRef {
  return {
    uid: user.uid,
    displayName: user.displayName || null,
    email: user.email || null,
  };
}

function revalidate() {
  revalidatePath("/guide");
  revalidatePath("/admin/guides");
}

export async function createGuide(
  input: GuideFormInput,
  draftId?: string,
): Promise<string> {
  const user = await requireEditor();
  const parsed = parseGuideInput(input);

  const slug = parsed.slug || slugify(parsed.title, "guide");
  const existing = await adminDb()
    .collection("guides")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new Error(`スラッグ "${slug}" は既に使用されています`);
  }

  const now = Timestamp.now();
  const author = authorRef(user);
  const payload = {
    slug,
    title: parsed.title,
    body: parsed.body,
    tags: parsed.tags,
    status: parsed.status,
    order: parsed.order,
    createdAt: now,
    updatedAt: now,
    createdBy: author,
    updatedBy: author,
  };

  let guideId: string;
  if (draftId !== undefined) {
    // Client supplied an id ahead of time so it could upload images to
    // `guides/{guideId}/...` before saving. Validate the shape to keep
    // anything else out of doc().set().
    if (!FIRESTORE_AUTO_ID.test(draftId)) {
      throw new Error("不正な下書きIDが指定されました");
    }
    const ref = adminDb().collection("guides").doc(draftId);
    // Defensive uniqueness check — collisions on auto-IDs are
    // astronomical, but if the client somehow reuses an id we don't
    // want to clobber an existing doc.
    const snap = await ref.get();
    if (snap.exists) {
      throw new Error("下書きIDが既に使われています");
    }
    await ref.set(payload);
    guideId = draftId;
  } else {
    const ref = await adminDb().collection("guides").add(payload);
    guideId = ref.id;
  }

  revalidate();
  redirect(`/admin/guides/${guideId}/edit`);
}

export async function updateGuide(
  guideId: string,
  input: GuideFormInput,
): Promise<void> {
  const user = await requireEditor();
  const parsed = parseGuideInput(input);
  const ref = adminDb().collection("guides").doc(guideId);

  if (parsed.slug) {
    const conflict = await adminDb()
      .collection("guides")
      .where("slug", "==", parsed.slug)
      .limit(2)
      .get();
    if (conflict.docs.some((d) => d.id !== guideId)) {
      throw new Error(`スラッグ "${parsed.slug}" は既に使用されています`);
    }
  }

  await ref.update({
    ...(parsed.slug ? { slug: parsed.slug } : {}),
    title: parsed.title,
    body: parsed.body,
    tags: parsed.tags,
    status: parsed.status,
    order: parsed.order,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: authorRef(user),
  });

  revalidate();
}

export async function deleteGuide(guideId: string): Promise<void> {
  await requireEditor();
  await adminDb().collection("guides").doc(guideId).delete();

  // Best-effort cleanup of any uploaded images. Logged and swallowed so a
  // Storage hiccup can't leave a half-deleted guide in Firestore; an
  // orphaned image is recoverable, a phantom Firestore doc is worse.
  try {
    await adminStorage()
      .bucket()
      .deleteFiles({ prefix: `guides/${guideId}/` });
  } catch (err) {
    console.warn(`Failed to clean up Storage for guide ${guideId}:`, err);
  }

  revalidate();
}
