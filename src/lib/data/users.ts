import "server-only";

import { cache } from "react";

import { adminDb } from "@/lib/firebase/admin";
import type { UserProfile } from "@/lib/types";

import { plainify } from "./serialize";

// Read the full users/{uid} Firestore doc. `SessionUser` (decoded session
// cookie) only carries the claim-side fields — `affiliation`/`emailOptIn`
// live on the Firestore profile and need a separate read.
//
// Returns `null` if the doc doesn't exist; that should only happen if
// someone has a valid session cookie but the profile bootstrap in
// `signInWithIdToken` never ran (e.g. cookie pre-dates that code path).
// Callers can fall back to the session fields in that case.
export async function getMyProfile(uid: string): Promise<UserProfile | null> {
  const snap = await adminDb().collection("users").doc(uid).get();
  if (!snap.exists) return null;
  // `plainify` so Admin SDK Timestamps survive the Server→Client boundary.
  return plainify(snap.data() as UserProfile);
}

// Shape returned to logged-out / cross-user readers of /u/[uid]. The
// public profile NEVER includes email, the visibility flags themselves,
// `emailOptIn`, or timestamps — only the fields the user has explicitly
// opted to publish (or that are always public: displayName/photoURL).
export interface PublicProfile {
  uid: string;
  displayName: string;
  photoURL: string | null;
  affiliation: string | null; // null when `affiliationPublic` is false
  bio: string | null; // null when `bioPublic` is false
}

// Pure projection: apply per-field visibility flags to a stored
// UserProfile and return only what's safe to render publicly. Exposed
// (rather than inlined into getPublicProfile) so it can be unit-tested
// without mocking Firestore — the visibility rules here are a privacy
// boundary and shouldn't regress silently.
//
// Treats missing/undefined visibility flags as `false` so docs that
// pre-date the flags don't accidentally leak.
export function projectPublicProfile(data: UserProfile): PublicProfile {
  return {
    uid: data.uid,
    displayName: data.displayName,
    photoURL: data.photoURL ?? null,
    affiliation: data.affiliationPublic ? (data.affiliation ?? "") : null,
    bio: data.bioPublic ? (data.bio ?? "") : null,
  };
}

// Read /u/[uid]'s public-safe view of a profile. Returns `null` if the
// user doesn't exist at all — distinct from "exists but everything is
// private", which returns a record with affiliation/bio = null but a
// real displayName.
//
// Wrapped in React's `cache()` so `generateMetadata` and the page body
// share a single Firestore read per request — without this they'd
// each fetch independently (per PR #59 Gemini review). The cache key
// is the uid and the cache lifetime is one request.
export const getPublicProfile = cache(
  async (uid: string): Promise<PublicProfile | null> => {
    const snap = await adminDb().collection("users").doc(uid).get();
    if (!snap.exists) return null;
    return projectPublicProfile(snap.data() as UserProfile);
  },
);
