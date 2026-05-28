"use server";

import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";

// Affiliation: trim and bound to a reasonable length. Empty string is the
// "no affiliation" sentinel (same shape signInWithIdToken bootstraps in
// src/app/actions/auth.ts), so we accept "" rather than requiring
// undefined.
const ProfileInputSchema = z.object({
  affiliation: z
    .string()
    .max(200, "所属は200文字以内で入力してください")
    .transform((s) => s.trim()),
  emailOptIn: z.boolean(),
});

export type ProfileFormInput = z.input<typeof ProfileInputSchema>;

function parseProfileInput(
  input: ProfileFormInput,
): z.infer<typeof ProfileInputSchema> {
  const result = ProfileInputSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

export async function updateMyProfile(
  input: ProfileFormInput,
): Promise<void> {
  const user = await requireUser();
  const parsed = parseProfileInput(input);

  // `update` (not `set`) so we only touch the two editable fields plus
  // updatedAt — leaves uid/email/displayName/photoURL/createdAt
  // untouched, and won't accidentally recreate a doc that the user
  // somehow lost.
  await adminDb().collection("users").doc(user.uid).update({
    affiliation: parsed.affiliation,
    emailOptIn: parsed.emailOptIn,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Affiliation also pre-fills the RSVP form on each event detail page,
  // so revalidate /events too. Cheap because the App Router only
  // re-renders pages actually visited.
  revalidatePath("/my/profile");
  revalidatePath("/events");
}
