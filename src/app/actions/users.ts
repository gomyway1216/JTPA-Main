"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireAdmin, requireUser } from "@/lib/auth/session";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";
import { actionError, inputError } from "@/lib/i18n/action-errors";
import type { ProjectAsset, UserLinks, UserProfile } from "@/lib/types";
import {
  isCanonicalAvatarUrl,
  isOwnedAvatarPath,
  isReservedUsername,
  isUnclaimedDefaultUsername,
  normalizeUsername,
  USERNAME_REGEX,
  validateUsernameFormat,
  type UsernameValidationError,
} from "@/lib/users-shared";

const USER_LINK_MAX = "userLinkMax";
const USER_URL_INVALID = "userUrlInvalid";
const USER_URL_PROTOCOL = "userUrlProtocol";
const USER_AFFILIATION_MAX = "userAffiliationMax";
const USER_BIO_MAX = "userBioMax";

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
    .max(MAX_LINK_LEN, USER_LINK_MAX)
    .url(USER_URL_INVALID)
    .refine(
      (s) => /^https?:\/\//i.test(s),
      USER_URL_PROTOCOL,
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
// enough to map back to localized username error strings.
const ProfileInputSchema = z.object({
  username: z.string().max(100), // outer cap; real shape check happens below
  affiliation: trimmedString(200, USER_AFFILIATION_MAX),
  bio: trimmedString(1000, USER_BIO_MAX),
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
export type SetEventAttendanceCountResult =
  | { ok: true }
  | { ok: false; error: string };
export type DeleteManagedUserResult =
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

const EventAttendanceCountInputSchema = z.object({
  uid: z.string().min(1),
  count: z.coerce.number().int().min(0).max(100000),
});

const DeleteManagedUserInputSchema = z.object({
  uid: z.string().min(1),
});

function isAuthUserNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "auth/user-not-found"
  );
}

async function localizeProfileInputIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
) {
  return Promise.all(
    issues.map(async (issue) => {
      let message = issue.message;
      if (message === USER_LINK_MAX) {
        message = await actionError("userLinkMax", { count: MAX_LINK_LEN });
      } else if (message === USER_URL_INVALID) {
        message = await actionError("userUrlInvalid");
      } else if (message === USER_URL_PROTOCOL) {
        message = await actionError("userUrlProtocol");
      } else if (message === USER_AFFILIATION_MAX) {
        message = await actionError("userAffiliationMax", { count: 200 });
      } else if (message === USER_BIO_MAX) {
        message = await actionError("userBioMax", { count: 1000 });
      }
      return { path: issue.path, message };
    }),
  );
}

async function usernameActionErrorMessage(
  err: UsernameValidationError,
): Promise<string> {
  switch (err) {
    case "empty":
      return actionError("usernameEmpty");
    case "format":
      return actionError("usernameHelp");
    case "reserved":
      return actionError("usernameReserved");
  }
}

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
    return {
      status: "invalid",
      reason: await usernameActionErrorMessage(formatErr),
    };
  }

  const resSnap = await adminDb().collection("usernames").doc(norm).get();
  if (!resSnap.exists) return { status: "available" };
  const ownerUid = (resSnap.data() as { uid: string }).uid;
  if (ownerUid === user.uid) return { status: "yours" };
  return { status: "taken" };
}

export async function setEventAttendanceCount(
  input: z.input<typeof EventAttendanceCountInputSchema>,
): Promise<SetEventAttendanceCountResult> {
  const admin = await requireAdmin();
  const parsed = EventAttendanceCountInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: await actionError("eventAttendanceCountInvalid"),
    };
  }

  const { uid, count } = parsed.data;
  const ref = adminDb().collection("users").doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, error: await actionError("userProfileMissing") };
  }

  const now = Timestamp.now();
  await ref.update({
    eventAttendanceCount: count,
    eventAttendanceCountEditedAt: now,
    eventAttendanceCountEditedBy: {
      uid: admin.uid,
      email: admin.email || null,
      displayName: admin.displayName || null,
    },
    updatedAt: now,
  });

  revalidatePath("/admin/users");
  revalidatePath(`/u/${uid}`);
  return { ok: true };
}

export async function deleteManagedUser(
  input: z.input<typeof DeleteManagedUserInputSchema>,
): Promise<DeleteManagedUserResult> {
  const admin = await requireAdmin();
  const parsed = DeleteManagedUserInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: await actionError("userDeleteUidRequired") };
  }

  const { uid } = parsed.data;
  if (uid === admin.uid) {
    return { ok: false, error: await actionError("userDeleteSelf") };
  }

  let isTargetAdmin = false;
  try {
    const target = await adminAuth().getUser(uid);
    isTargetAdmin = target.customClaims?.admin === true;
  } catch (err) {
    if (isAuthUserNotFound(err)) {
      return { ok: false, error: await actionError("userDeleteNotFound") };
    }
    throw err;
  }

  // Keep account deletion narrower than role management: admin accounts must
  // be demoted first. That avoids irreversible "delete the last admin" races
  // across Firebase Auth, which does not support transactions.
  if (isTargetAdmin) {
    return { ok: false, error: await actionError("userDeleteAdmin") };
  }

  let avatarPath: string | null = null;
  await adminDb().runTransaction(async (tx) => {
    const userRef = adminDb().collection("users").doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) return;

    const profile = userSnap.data() as UserProfile;
    const username = profile.username;
    const usernameRef = username
      ? adminDb().collection("usernames").doc(username)
      : null;
    const usernameSnap = usernameRef ? await tx.get(usernameRef) : null;

    avatarPath = profile.avatar?.path ?? null;
    tx.delete(userRef);
    if (
      usernameRef &&
      usernameSnap?.exists &&
      (usernameSnap.data() as { uid?: string }).uid === uid
    ) {
      tx.delete(usernameRef);
    }
  });

  try {
    await adminAuth().deleteUser(uid);
  } catch (err) {
    if (!isAuthUserNotFound(err)) throw err;
  }

  if (avatarPath) {
    await adminStorage()
      .bucket()
      .file(avatarPath)
      .delete()
      .catch((err) => {
        console.warn(`Failed to delete avatar for deleted user ${uid}:`, err);
      });
  }

  revalidatePath("/admin/users");
  revalidatePath(`/u/${uid}`);
  return { ok: true };
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
    return {
      ok: false,
      error: await inputError(
        await localizeProfileInputIssues(parsed.error.issues),
      ),
    };
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
    return { ok: false, error: await usernameActionErrorMessage(usernameErr) };
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
    return { ok: false, error: await actionError("usernameFormatInvalid") };
  }
  if (isReservedUsername(desiredUsername) !== desiredIsReserved) {
    // Sanity check: the two helpers must agree. If they ever
    // disagree, something has drifted and we should fail closed.
    return { ok: false, error: await actionError("usernameValidationFailed") };
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

      // A user who never explicitly picked a handle has no stored
      // `username`; the form pre-fills the reserved `user-*` default
      // placeholder, so an untouched save submits a reserved handle that
      // doesn't match their (absent) current one. Treat that as
      // "username unchanged" rather than a forbidden claim — otherwise
      // every profile edit by such a user fails (issue #104). See
      // isUnclaimedDefaultUsername for the full rationale.
      const keepDefaultHandle = isUnclaimedDefaultUsername(
        user.uid,
        currentUsername,
        desiredUsername,
      );

      // Grandfather: a reserved-by-rule handle is still allowed as
      // long as it matches the user's CURRENT username (i.e. they're
      // saving the rest of their profile without renaming), or it's the
      // unclaimed default placeholder above. New claims into the
      // reserved namespace are still blocked. Per PR #94 Copilot review.
      if (
        desiredIsReserved &&
        currentUsername !== desiredUsername &&
        !keepDefaultHandle
      ) {
        throw new Error("USERNAME_RESERVED");
      }

      if (currentUsername !== desiredUsername && !keepDefaultHandle) {
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
        // Keep `username` absent when the user is just holding onto the
        // unclaimed default placeholder (issue #104): persisting it would
        // bake a reserved `user-*` handle into the doc and leave a stray
        // reservation slot. FieldValue.delete() (rather than merely
        // omitting the key) also scrubs any legacy stray null/"" username,
        // so the doc is truly absent and the public projection keeps
        // falling back to defaultUsernameFor(uid), as designed.
        username: keepDefaultHandle ? FieldValue.delete() : desiredUsername,
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
        error: await actionError("usernameTaken"),
      };
    }
    if (err instanceof Error && err.message === "USERNAME_RESERVED") {
      // Reserved namespace (currently `user-*`) — distinct error so
      // the user knows the issue is "system-reserved" rather than
      // "taken by someone else".
      return {
        ok: false,
        error: await actionError("usernameReserved"),
      };
    }
    if (err instanceof Error && err.message === "PROFILE_DOC_MISSING") {
      return {
        ok: false,
        error: await actionError("profileMissingRelogin"),
      };
    }
    console.error("updateMyProfile failed:", err);
    return {
      ok: false,
      error: await actionError("saveRetry"),
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
    return { ok: false, error: await actionError("avatarInvalidInput") };
  }
  const { path, url } = parsed.data;

  // Re-validate both halves of the client-supplied {path, url} against the
  // caller's own folder + the canonical Storage URL (helpers in
  // users-shared). Per PR #96 Copilot + Gemini security review: the old
  // `url.includes(encodeURIComponent(path))` check let a forged off-Storage
  // host (e.g. https://evil.example.com/users%2F…) through, which would
  // then be served to everyone viewing the avatar.
  if (!isOwnedAvatarPath(user.uid, path)) {
    return { ok: false, error: await actionError("avatarInvalidPath") };
  }
  // Take the bucket name from env (the exact value the client embeds in the
  // download URL) rather than `adminStorage().bucket().name`: the latter
  // throws synchronously when no default bucket is configured, and this
  // check runs OUTSIDE the try/catch below — an unhandled throw here would
  // surface to the client as the masked generic "Server Components render"
  // error instead of a clean inline message.
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) {
    // Env not wired up at all — distinct from a tampered URL. Log it so the
    // misconfiguration is debuggable, and tell the user it's a system/config
    // error rather than surfacing a misleading "invalid URL". Per PR #109
    // Gemini review.
    console.error(
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET is not set; cannot validate avatar URL.",
    );
    return {
      ok: false,
      error: await actionError("avatarConfigError"),
    };
  }
  if (!isCanonicalAvatarUrl(url, bucketName, path)) {
    return { ok: false, error: await actionError("avatarInvalidUrl") };
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
        error: await actionError("profileMissingRelogin"),
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
      error: await actionError("avatarSaveRetry"),
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
      error: await actionError("avatarDeleteRetry"),
    };
  }

  revalidatePath("/my/profile");
  revalidatePath(`/u/${user.uid}`);
  return { ok: true };
}
