"use server";

import { FieldValue } from "firebase-admin/firestore";

import { adminAuth, adminDb } from "@/lib/firebase/admin";
import {
  clearSessionCookie,
  createSessionCookie,
} from "@/lib/auth/session";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";

export async function signInWithIdToken(idToken: string): Promise<void> {
  const decoded = await adminAuth().verifyIdToken(idToken, true);

  // Compute the role badge from the decoded token's custom claims so we
  // can both bootstrap and self-heal the denormalized `roleBadge` field
  // in `users/{uid}` on every sign-in. Order matches the role hierarchy
  // used everywhere else (admin > editor > contributor). Returning
  // `null` for a plain user makes the upsert / merge branch below drop
  // the field entirely (via FieldValue.delete in the merge branch and
  // simply omitting it in the create branch).
  const claimBadge: "admin" | "editor" | "contributor" | null =
    decoded.admin === true
      ? "admin"
      : decoded.editor === true
        ? "editor"
        : decoded.contributor === true
          ? "contributor"
          : null;

  // Upsert user profile (first login bootstraps the profile doc).
  const ref = adminDb().collection("users").doc(decoded.uid);
  const now = new Date();
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      uid: decoded.uid,
      email: decoded.email ?? "",
      displayName: decoded.name ?? decoded.email?.split("@")[0] ?? "User",
      photoURL: decoded.picture ?? null,
      affiliation: "",
      bio: "",
      // Only include `roleBadge` when the user actually has a claim.
      // Avoids writing `roleBadge: null` (which would round-trip back
      // to the public projection as a deliberate "no role" rather
      // than absent).
      ...(claimBadge ? { roleBadge: claimBadge } : {}),
      // Default-private for affiliation/bio/fullName so signup doesn't
      // silently expose anything until the user explicitly opts in on
      // /my/profile. emailOptIn defaults to true because that's the
      // long-standing onboarding behavior — users get JTPA
      // announcements and can opt out from the profile page.
      //
      // `username` is intentionally NOT set here — leaving it absent
      // makes the public-profile projection fall back to
      // `defaultUsernameFor(uid)` for display while leaving the
      // `usernames/{handle}` reservation slot free. The user claims a
      // real handle (which writes both `users.username` and the
      // reservation doc atomically) the first time they save
      // /my/profile. See projectPublicProfile in src/lib/data/users.ts.
      affiliationPublic: false,
      bioPublic: false,
      fullNamePublic: false,
      links: {},
      emailOptIn: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    await ref.set(
      {
        email: decoded.email ?? snap.get("email") ?? "",
        displayName: decoded.name ?? snap.get("displayName"),
        photoURL: decoded.picture ?? snap.get("photoURL") ?? null,
        // Self-healing role badge sync: write the current claim's badge
        // (or delete the field if no claim) so the denormalized value
        // in the user doc matches the source of truth in Auth every
        // sign-in. Catches drift from claim flips that happened while
        // the user wasn't signed in, or from a legacy doc that pre-
        // dates this field.
        roleBadge: claimBadge ?? FieldValue.delete(),
        updatedAt: now,
      },
      { merge: true },
    );
  }

  await createSessionCookie(idToken);
}

export async function signOut(locale?: string): Promise<void> {
  await clearSessionCookie();
  return redirectToLocalizedPath("/", locale);
}
