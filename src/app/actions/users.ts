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
// Bio: longer (multi-line) self-introduction. Capped at 1000 to keep the
// public profile card readable without scrolling and avoid pathological
// payloads. Newlines preserved by `whitespace-pre-wrap` on display.
//
// `preprocess`-then-`max` ordering matters: a `.transform(trim)` chained
// after `.max(...)` would let a string padded by leading/trailing
// whitespace fail validation even though the trimmed value is well
// within the cap (per PR #57 Copilot review).
const trimmedString = (max: number, message: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().max(max, message),
  );

const ProfileInputSchema = z.object({
  affiliation: trimmedString(200, "所属は200文字以内で入力してください"),
  bio: trimmedString(1000, "紹介文は1000文字以内で入力してください"),
  affiliationPublic: z.boolean(),
  bioPublic: z.boolean(),
  emailOptIn: z.boolean(),
});

export type ProfileFormInput = z.input<typeof ProfileInputSchema>;

// Returned by the server action. Errors are surfaced via this object
// rather than as thrown exceptions because Next.js Server Actions mask
// unhandled-error messages with a generic "Internal Server Error" in
// production builds — `err.message` on the client would never reach the
// user (per PR #59 Gemini review). The form uses `result.error` to
// render the actual validation text.
export type UpdateProfileResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateMyProfile(
  input: ProfileFormInput,
): Promise<UpdateProfileResult> {
  // requireUser() throws if the session cookie is missing/invalid; let
  // that propagate as an actual exception (the form catches it, but it
  // also pre-empts every other failure mode below).
  const user = await requireUser();

  const parsed = ProfileInputSchema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `入力エラー: ${message}` };
  }

  // `update` (not `set`) so we only touch the editable fields plus
  // updatedAt — leaves uid/email/displayName/photoURL/createdAt
  // untouched, and won't accidentally recreate a doc that the user
  // somehow lost.
  try {
    await adminDb().collection("users").doc(user.uid).update({
      affiliation: parsed.data.affiliation,
      bio: parsed.data.bio,
      affiliationPublic: parsed.data.affiliationPublic,
      bioPublic: parsed.data.bioPublic,
      emailOptIn: parsed.data.emailOptIn,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Most plausible cause: the users/{uid} doc doesn't exist (user
    // session predates the bootstrap, or someone manually deleted it).
    // Surface a recoverable message rather than a generic 500.
    console.error("updateMyProfile failed:", err);
    return {
      ok: false,
      error: "保存に失敗しました。一度ログアウトして再ログインしてください。",
    };
  }

  // Affiliation pre-fills the RSVP form on each event DETAIL page
  // (`/events/[slug]`), so revalidating the static `/events` list isn't
  // enough — pass the dynamic-route template + `"page"` so all cached
  // slug entries get cleared (per PR #57 Gemini review). affiliation/bio
  // + their visibility flags also drive the public /u/[uid] page —
  // revalidate that too.
  revalidatePath("/my/profile");
  revalidatePath("/events/[slug]", "page");
  revalidatePath(`/u/${user.uid}`);

  return { ok: true };
}
