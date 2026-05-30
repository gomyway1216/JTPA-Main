"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type { UserLinks, UserProfile } from "@/lib/types";
import {
  isReservedUsername,
  normalizeUsername,
  USERNAME_REGEX,
  usernameErrorMessage,
  validateUsernameFormat,
} from "@/lib/users-shared";

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

// Per-link cap. 500 chars is well past any realistic profile URL
// (long OAuth-style query strings included) and keeps payloads bounded
// in case a client sends a paste-mistake.
const MAX_LINK_LEN = 500;

// Optional URL field that accepts empty string (= "clear this link") or
// a valid http(s) URL. Returns `undefined` for empty so the Firestore
// write strips the field entirely (no zombie empty strings on the doc).
const optionalUrl = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    const t = v.trim();
    return t === "" ? undefined : t;
  },
  z
    .string()
    .max(MAX_LINK_LEN, `リンクは${MAX_LINK_LEN}文字以内で入力してください`)
    .url("URLの形式が正しくありません")
    .refine(
      (s) => /^https?:\/\//i.test(s),
      "http:// または https:// で始まるURLを入力してください",
    )
    .optional(),
);

const LinksSchema = z.object({
  portfolio: optionalUrl,
  github: optionalUrl,
  linkedin: optionalUrl,
  sns: optionalUrl,
});

// Username field accepts the raw input; we normalize + validate in code
// rather than chaining transforms here so the error type is precise
// enough to map back to the shared `usernameErrorMessage` strings.
const ProfileInputSchema = z.object({
  username: z.string().max(100), // outer cap; real shape check happens below
  affiliation: trimmedString(200, "所属は200文字以内で入力してください"),
  bio: trimmedString(1000, "紹介文は1000文字以内で入力してください"),
  affiliationPublic: z.boolean(),
  bioPublic: z.boolean(),
  fullNamePublic: z.boolean(),
  emailOptIn: z.boolean(),
  links: LinksSchema,
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

// Public-availability probe used by the live-validation UI on
// /my/profile. Returns "available" / "taken" / "yours" (already the
// caller's current handle — useful so the form can show a neutral
// "no change" state instead of a spurious "taken"). Never reserves
// anything — the actual claim happens transactionally inside
// updateMyProfile so two tabs racing to the same name still produce
// exactly one winner.
export type UsernameAvailability =
  | { status: "available" }
  | { status: "taken" }
  | { status: "yours" }
  | { status: "invalid"; reason: string };

export async function checkUsernameAvailable(
  desired: string,
): Promise<UsernameAvailability> {
  const user = await requireUser();
  const norm = normalizeUsername(desired);
  const formatErr = validateUsernameFormat(norm);
  if (formatErr) {
    // Grandfather exception: a "reserved" error on a handle that's
    // already the user's current username means they're trying to
    // save WITHOUT renaming — e.g. a profile doc that was created
    // before the prefix rule landed, and the user just wants to
    // edit their bio. Don't block that. The rule is about new
    // claims, not about confiscating handles already in use.
    //
    // Two-step lookup: confirm with the reservation registry that
    // the caller is actually the owner (don't trust the input
    // alone). The reservation doc id is the handle itself, so this
    // is a single point read.
    if (formatErr === "reserved") {
      const ownedSnap = await adminDb()
        .collection("usernames")
        .doc(norm)
        .get();
      if (
        ownedSnap.exists &&
        (ownedSnap.data() as { uid: string }).uid === user.uid
      ) {
        return { status: "yours" };
      }
    }
    return { status: "invalid", reason: usernameErrorMessage(formatErr) };
  }

  const resSnap = await adminDb().collection("usernames").doc(norm).get();
  if (!resSnap.exists) return { status: "available" };
  const ownerUid = (resSnap.data() as { uid: string }).uid;
  if (ownerUid === user.uid) return { status: "yours" };
  return { status: "taken" };
}

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

  // Username gets its own validation pass with the shared helper so the
  // error strings line up with what the form shows live. Normalize once
  // here and reuse below for both the reservation doc id and the user
  // doc field write — keeping a single canonical form prevents drift
  // between "what the user typed" and "what we stored".
  const desiredUsername = normalizeUsername(parsed.data.username);
  const usernameErr = validateUsernameFormat(desiredUsername);
  // Empty / format errors are unconditional — fail fast without
  // touching Firestore. "reserved" is deferred to the transaction
  // below: a reserved handle is still OK if it's already the user's
  // current one (grandfathered claim), and we need to read the user
  // doc to know that. Per PR #94 Copilot review.
  if (usernameErr && usernameErr !== "reserved") {
    return { ok: false, error: usernameErrorMessage(usernameErr) };
  }
  const desiredIsReserved = usernameErr === "reserved";

  // Belt-and-suspenders: re-assert the format + reservation rules
  // against the raw helpers in case a future refactor splits
  // `validateUsernameFormat` and one path silently loosens. Use the
  // shared `isReservedUsername` (covers exact names + prefixes) so
  // the two checks can't drift — per PR #94 Gemini review, which
  // spotted that the previous re-check only consulted the exact-name
  // set and would have accepted a `user-*` payload that bypassed
  // `validateUsernameFormat`.
  if (!USERNAME_REGEX.test(desiredUsername)) {
    return { ok: false, error: "ユーザーネームの形式が正しくありません" };
  }
  if (isReservedUsername(desiredUsername) !== desiredIsReserved) {
    // Sanity check: the two helpers must agree. If they ever
    // disagree, something has drifted and we should fail closed.
    return { ok: false, error: "ユーザーネームの検証に失敗しました" };
  }

  // Normalize links: drop empty/undefined slots so the stored object
  // only contains inhabited URLs. Zod's `optionalUrl` already turned
  // empty strings into undefined; this just builds the final object.
  const links: UserLinks = {};
  if (parsed.data.links.portfolio) links.portfolio = parsed.data.links.portfolio;
  if (parsed.data.links.github) links.github = parsed.data.links.github;
  if (parsed.data.links.linkedin) links.linkedin = parsed.data.links.linkedin;
  if (parsed.data.links.sns) links.sns = parsed.data.links.sns;

  // Single transaction so the username swap (claim new + release old)
  // and the profile update either all succeed or all roll back. Without
  // the transaction, a crash between "claim" and "release" would leave
  // a zombie reservation; a crash between "release" and "user doc
  // update" would orphan the handle.
  try {
    await adminDb().runTransaction(async (tx) => {
      const userRef = adminDb().collection("users").doc(user.uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        // Distinct error so the catch below can surface the
        // re-login hint instead of a generic save failure.
        throw new Error("PROFILE_DOC_MISSING");
      }
      const userData = userSnap.data() as UserProfile;
      const currentUsername = userData.username;

      // Grandfather: a reserved-by-rule handle is still allowed as
      // long as it matches the user's CURRENT username (i.e. they're
      // saving the rest of their profile without renaming). New
      // claims into the reserved namespace are still blocked. Per
      // PR #94 Copilot review.
      if (desiredIsReserved && currentUsername !== desiredUsername) {
        throw new Error("USERNAME_RESERVED");
      }

      if (currentUsername !== desiredUsername) {
        // Firestore transactions require ALL reads to happen before
        // ANY writes — interleaving throws "Firestore transactions
        // require all reads to be executed before all writes" at
        // commit time. So we read both reservation slots up front,
        // then branch on the snapshots to decide what to write.
        // Per PR #79 Gemini + Copilot reviews.
        const newResRef = adminDb()
          .collection("usernames")
          .doc(desiredUsername);
        const oldResRef = currentUsername
          ? adminDb().collection("usernames").doc(currentUsername)
          : null;

        const [newResSnap, oldResSnap] = await Promise.all([
          tx.get(newResRef),
          oldResRef ? tx.get(oldResRef) : Promise.resolve(null),
        ]);

        if (newResSnap.exists) {
          const ownerUid = (newResSnap.data() as { uid: string }).uid;
          if (ownerUid !== user.uid) {
            throw new Error("USERNAME_TAKEN");
          }
          // Edge case: a previous interrupted save left us owning a
          // reservation for `desiredUsername` but the user doc didn't
          // get updated to match. Fall through and rewrite both —
          // the reservation set + user update below converge on a
          // consistent state.
        }

        // ----- writes (after all reads above) -----
        tx.set(newResRef, {
          uid: user.uid,
          createdAt: Timestamp.now(),
        });
        if (
          oldResRef &&
          oldResSnap?.exists &&
          (oldResSnap.data() as { uid: string }).uid === user.uid
        ) {
          // Release the old slot so another user can claim it. Defensive
          // ownership check (should always be us, but a stale doc would
          // otherwise wipe someone else's reservation).
          tx.delete(oldResRef);
        }
      }

      tx.update(userRef, {
        username: desiredUsername,
        affiliation: parsed.data.affiliation,
        bio: parsed.data.bio,
        affiliationPublic: parsed.data.affiliationPublic,
        bioPublic: parsed.data.bioPublic,
        fullNamePublic: parsed.data.fullNamePublic,
        emailOptIn: parsed.data.emailOptIn,
        links,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "USERNAME_TAKEN") {
      return {
        ok: false,
        error: "そのユーザーネームは既に使われています。別の名前を入力してください。",
      };
    }
    if (err instanceof Error && err.message === "USERNAME_RESERVED") {
      // Reserved namespace (currently `user-*`) — distinct error so
      // the user knows the issue is "system-reserved" rather than
      // "taken by someone else".
      return {
        ok: false,
        error: "このユーザーネームは予約済みです",
      };
    }
    if (err instanceof Error && err.message === "PROFILE_DOC_MISSING") {
      return {
        ok: false,
        error:
          "プロフィールが見つかりません。一度ログアウトして再ログインしてください。",
      };
    }
    console.error("updateMyProfile failed:", err);
    return {
      ok: false,
      error: "保存に失敗しました。時間を置いて再試行してください。",
    };
  }

  // Affiliation pre-fills the RSVP form on each event DETAIL page
  // (`/events/[slug]`), so revalidating the static `/events` list isn't
  // enough — pass the dynamic-route template + `"page"` so all cached
  // slug entries get cleared (per PR #57 Gemini review). The public
  // profile card on /u/[uid] also depends on every editable field
  // (including the username + links + fullName toggle), so revalidate
  // that as well.
  revalidatePath("/my/profile");
  revalidatePath("/events/[slug]", "page");
  revalidatePath(`/u/${user.uid}`);

  return { ok: true };
}
