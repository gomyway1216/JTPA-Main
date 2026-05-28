"use server";

import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";

// Affiliation: trim FIRST, then bound to a reasonable length. Empty
// string is the "no affiliation" sentinel (same shape signInWithIdToken
// bootstraps in src/app/actions/auth.ts), so we accept "" rather than
// requiring undefined.
//
// `preprocess`-then-`max` ordering matters: a `.transform(trim)` chained
// after `.max(200)` would let a 250-char string of mostly whitespace
// fail validation even though the trimmed value is well within the cap
// (per PR #57 Copilot review).
const trimmedString = (max: number, message: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().max(max, message),
  );

const ProfileInputSchema = z.object({
  affiliation: trimmedString(200, "所属は200文字以内で入力してください"),
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

  // Affiliation pre-fills the RSVP form on each event DETAIL page
  // (`/events/[slug]`), so revalidating the static `/events` list isn't
  // enough — pass the dynamic-route template + `"page"` so all cached
  // slug entries get cleared (per PR #57 Gemini review).
  revalidatePath("/my/profile");
  revalidatePath("/events/[slug]", "page");
}
