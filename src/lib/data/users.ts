import "server-only";

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
