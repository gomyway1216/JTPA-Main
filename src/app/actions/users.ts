"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireUser } from "@/lib/auth/session";
import { adminDb, adminStorage } from "@/lib/firebase/admin";
import type { ProjectAsset, UserLinks, UserProfile } from "@/lib/types";
import {
  isCanonicalAvatarUrl,
  isOwnedAvatarPath,
  normalizeUsername,
  RESERVED_USERNAMES,
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
  if (usernameErr) {
    return { ok: false, error: usernameErrorMessage(usernameErr) };
  }
  // RESERVED_USERNAMES is already covered by validateUsernameFormat but
  // re-asserting USERNAME_REGEX here is a belt-and-suspenders against a
  // future helper change that loosens one path without the other.
  if (!USERNAME_REGEX.test(desiredUsername)) {
    return { ok: false, error: "ユーザーネームの形式が正しくありません" };
  }
  if (RESERVED_USERNAMES.has(desiredUsername)) {
    return { ok: false, error: "このユーザーネームは予約済みです" };
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

// ---------- avatar ----------

// Result shape for the avatar mutations. Mirrors UpdateProfileResult: the
// client renders `error` inline rather than relying on a thrown message
// (which Next masks as a generic 500 in production builds).
export type UpdateAvatarResult = { ok: true } | { ok: false; error: string };

// Loose shape check for the {path, url} the client sends after uploading
// to Storage. The real authorization guard is the per-caller path/url
// pinning inside updateMyAvatar — this just bounds the payload.
const AvatarAssetSchema = z.object({
  path: z.string().min(1).max(500),
  url: z.string().max(1000).url(),
});

// Best-effort delete of a single Storage object — reclaims the previous
// avatar when it's replaced or removed. Same swallow-and-log posture as
// `deleteStoragePaths` in actions/posts.ts: the Firestore `avatar` field
// is the source of truth for what's shown, so a stray object is at worst
// wasted bucket space and must never surface as a user-facing error.
async function deleteAvatarObject(path: string): Promise<void> {
  await adminStorage()
    .bucket()
    .file(path)
    .delete()
    .catch((err) => {
      console.warn("Failed to delete avatar object:", path, err);
    });
}

// Persist a freshly-uploaded avatar. The client has already pushed the
// file to `users/{uid}/...` in Storage (allowed by storage.rules) and
// passes back the resulting {path, url}. We re-validate ownership here
// because that payload is client-controlled:
//   - `path` must live under the caller's own `users/{uid}/` folder
//   - `url` must be the download URL FOR that path (it embeds the
//     percent-encoded path), so a tampered payload can't repoint the
//     avatar at someone else's object or an arbitrary off-Storage host.
export async function updateMyAvatar(
  asset: ProjectAsset,
): Promise<UpdateAvatarResult> {
  const user = await requireUser();

  const parsed = AvatarAssetSchema.safeParse(asset);
  if (!parsed.success) {
    return { ok: false, error: "アイコンの保存に失敗しました（不正な入力）" };
  }
  const { path, url } = parsed.data;

  // Re-validate both halves of the client-supplied {path, url} against the
  // caller's own folder + the canonical Storage URL (helpers in
  // users-shared). Per PR #96 Copilot + Gemini security review: the old
  // `url.includes(encodeURIComponent(path))` check let a forged off-Storage
  // host (e.g. https://evil.example.com/users%2F…) through, which would
  // then be served to everyone viewing the avatar.
  if (!isOwnedAvatarPath(user.uid, path)) {
    return { ok: false, error: "アイコンの保存に失敗しました（不正なパス）" };
  }
  if (!isCanonicalAvatarUrl(url, adminStorage().bucket().name, path)) {
    return { ok: false, error: "アイコンの保存に失敗しました（不正なURL）" };
  }

  const userRef = adminDb().collection("users").doc(user.uid);
  try {
    // Read the prior avatar first so we can sweep its Storage object after
    // the field is repointed (orphan cleanup, mirroring orphanPaths in
    // actions/posts.ts).
    const snap = await userRef.get();
    if (!snap.exists) {
      return {
        ok: false,
        error:
          "プロフィールが見つかりません。一度ログアウトして再ログインしてください。",
      };
    }
    const prev = (snap.data() as UserProfile).avatar;

    await userRef.update({
      avatar: { path, url },
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Delete the old object only after the field is repointed, and only
    // when the path actually changed (re-uploading the same path would
    // otherwise delete the object we just wrote).
    if (prev?.path && prev.path !== path) {
      await deleteAvatarObject(prev.path);
    }
  } catch (err) {
    console.error("updateMyAvatar failed:", err);
    return {
      ok: false,
      error: "アイコンの保存に失敗しました。時間を置いて再試行してください。",
    };
  }

  revalidatePath("/my/profile");
  revalidatePath(`/u/${user.uid}`);
  return { ok: true };
}

// Clear a custom avatar, falling the user's icon back to the Google
// `photoURL` (or the initials circle). Deletes the Storage object too.
export async function removeMyAvatar(): Promise<UpdateAvatarResult> {
  const user = await requireUser();

  const userRef = adminDb().collection("users").doc(user.uid);
  try {
    const snap = await userRef.get();
    const prev = snap.exists
      ? (snap.data() as UserProfile).avatar
      : undefined;

    await userRef.update({
      avatar: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    if (prev?.path) {
      await deleteAvatarObject(prev.path);
    }
  } catch (err) {
    console.error("removeMyAvatar failed:", err);
    return {
      ok: false,
      error: "アイコンの削除に失敗しました。時間を置いて再試行してください。",
    };
  }

  revalidatePath("/my/profile");
  revalidatePath(`/u/${user.uid}`);
  return { ok: true };
}
