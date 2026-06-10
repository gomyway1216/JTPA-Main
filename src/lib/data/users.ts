import "server-only";

import { cache } from "react";

import { adminDb } from "@/lib/firebase/admin";
import type { UserLinks, UserProfile } from "@/lib/types";
import { defaultUsernameFor } from "@/lib/users-shared";

import { fromSnap } from "./from-snap";
import { UserProfileSchema } from "./schemas";
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
  return plainify(fromSnap<UserProfile>(snap, UserProfileSchema, "users"));
}

// Resolve just the custom-avatar URL for a user. Used by the root layout
// to swap the header icon to an uploaded avatar without pulling the whole
// profile doc through `getMyProfile`/`plainify` on every page render.
// Returns the uploaded avatar URL, or null when the user hasn't set one —
// the caller then falls back to the Google `photoURL` carried on the
// session. Wrapped in React's `cache()` so repeated reads within a single
// request collapse to one Firestore round-trip.
export const getMyAvatarUrl = cache(
  async (uid: string): Promise<string | null> => {
    // Called from the root layout on EVERY logged-in request, so a
    // transient Firestore error must NOT 500 the whole site. Swallow it and
    // fall back to null — the caller then keeps the Google `photoURL` from
    // the session. Per PR #96 Gemini review.
    try {
      const snap = await adminDb().collection("users").doc(uid).get();
      if (!snap.exists) return null;
      const data = fromSnap<UserProfile>(snap, UserProfileSchema, "users");
      return data.avatar?.url ?? null;
    } catch (err) {
      console.error("getMyAvatarUrl failed:", err);
      return null;
    }
  },
);

// Shape returned to logged-out / cross-user readers of /u/[uid] AND to
// every list/detail surface that renders a name + avatar. NEVER
// includes email, the visibility flags themselves, `emailOptIn`, or
// timestamps — only the always-public handles (username/photoURL) plus
// whatever the user has explicitly opted to publish.
export interface PublicProfile {
  uid: string;
  // Always present after the bootstrap migration. The empty string is
  // returned for the (theoretical) case where a doc is missing both a
  // username and a uid we can derive one from — every render path treats
  // an empty username the same as a deleted user.
  username: string;
  // The Google-account real name. Only populated when the user opted
  // into `fullNamePublic`; null otherwise. The /u/[uid] page renders
  // this as a secondary label under the username; list/detail surfaces
  // ignore it.
  fullName: string | null;
  photoURL: string | null;
  affiliation: string | null; // null when `affiliationPublic` is false
  bio: string | null; // null when `bioPublic` is false
  // Always-public when set. Empty/undefined slots are stripped so the
  // /u/[uid] icon row only renders inhabited links.
  links: UserLinks;
  // Highest role for the user, denormalized from Auth custom claims so
  // `AuthorBadge` can render a role pill (Admin / Editor / Contributor)
  // alongside the @username without an Auth read per page. `null` for
  // plain users / when the docs lacks the field yet (older accounts that
  // haven't signed in since the bootstrap that writes this field).
  role: "admin" | "editor" | "contributor" | null;
  // Always-public cumulative event attendance count. Missing or malformed
  // legacy values are rendered as 0.
  eventAttendanceCount: number;
}

function normalizedPublicCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : 0;
}

// Pure projection: apply per-field visibility flags to a stored
// UserProfile and return only what's safe to render publicly. Exposed
// (rather than inlined into getPublicProfile) so it can be unit-tested
// without mocking Firestore — the visibility rules here are a privacy
// boundary and shouldn't regress silently.
//
// Treats missing/undefined visibility flags as `false` so docs that
// pre-date the flags don't accidentally leak. Backfills `username` from
// the uid if the field hasn't been written yet (read-side belt-and-
// suspenders against the bootstrap not having run for some accounts);
// the value matches what the server-side migration would write.
export function projectPublicProfile(data: UserProfile): PublicProfile {
  const links: UserLinks = {};
  if (data.links) {
    // Drop empty strings so the icon row doesn't render a bare <a> with
    // no href. The write path already normalizes empty → undefined, but
    // we re-check on read because older docs may have stored "".
    if (data.links.portfolio) links.portfolio = data.links.portfolio;
    if (data.links.github) links.github = data.links.github;
    if (data.links.linkedin) links.linkedin = data.links.linkedin;
    if (data.links.sns) links.sns = data.links.sns;
  }
  // Defensive read: only forward known role values so a malformed write
  // (or a legacy doc with a stale string) can't surface unexpected
  // strings into the public surface.
  const role: PublicProfile["role"] =
    data.roleBadge === "admin"
      ? "admin"
      : data.roleBadge === "editor"
        ? "editor"
        : data.roleBadge === "contributor"
          ? "contributor"
          : null;
  return {
    uid: data.uid,
    username: data.username || defaultUsernameFor(data.uid),
    fullName: data.fullNamePublic ? data.displayName : null,
    // Custom uploaded avatar wins over the Google `photoURL`; both fall
    // back to null so the UI renders the initials circle. See
    // UserProfile.avatar for why the two are separate fields.
    photoURL: data.avatar?.url ?? data.photoURL ?? null,
    affiliation: data.affiliationPublic ? (data.affiliation ?? "") : null,
    bio: data.bioPublic ? (data.bio ?? "") : null,
    links,
    role,
    eventAttendanceCount: normalizedPublicCount(data.eventAttendanceCount),
  };
}

// Read /u/[uid]'s public-safe view of a profile. Returns `null` if the
// user doesn't exist at all — distinct from "exists but everything is
// private", which returns a record with affiliation/bio = null but a
// real username.
//
// Wrapped in React's `cache()` so `generateMetadata` and the page body
// share a single Firestore read per request — without this they'd
// each fetch independently (per PR #59 Gemini review). The cache key
// is the uid and the cache lifetime is one request.
export const getPublicProfile = cache(
  async (uid: string): Promise<PublicProfile | null> => {
    const snap = await adminDb().collection("users").doc(uid).get();
    if (!snap.exists) return null;
    return projectPublicProfile(
      fromSnap<UserProfile>(snap, UserProfileSchema, "users"),
    );
  },
);

// Inner cached implementation, keyed by a normalized sorted-string.
// React's `cache()` matches arguments by reference identity (===), so
// wrapping a function that takes an array would never hit on a
// second call — every caller builds a fresh array literal. The string
// key collapses two calls with the same uid set (in any order) to
// one Firestore round-trip per request.
//
// `key` is "" for an empty uid set so the public wrapper can
// short-circuit before even calling in.
//
// Why a single `getAll` per call:
//   - one Firestore round-trip per page instead of N
//   - keeps the rules path identical (Admin SDK, server-only)
const _getPublicProfilesByKey = cache(
  async (key: string): Promise<Map<string, PublicProfile>> => {
    const out = new Map<string, PublicProfile>();
    if (!key) return out;
    const unique = key.split(",");
    const refs = unique.map((u) => adminDb().collection("users").doc(u));
    // `getAll(...refs)` is the Admin SDK batch read — single RPC for the
    // whole set. Result order matches `refs`, so we can zip with `unique`.
    const snaps = await adminDb().getAll(...refs);
    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      if (!snap.exists) continue;
      out.set(
        unique[i],
        projectPublicProfile(
          fromSnap<UserProfile>(snap, UserProfileSchema, "users"),
        ),
      );
    }
    return out;
  },
);

// Batch-fetch public profiles for the set of uids that a single page
// will render (post + comment authors, list rows, etc.). Returns a Map
// keyed by uid; missing uids (deleted accounts, walk-in guests whose
// uids never had a users/{uid} doc) are simply absent from the map so
// the caller can render a "@unknown" fallback.
//
// Two different surfaces in the same render that ask for overlapping
// uid sets share a single round-trip via `_getPublicProfilesByKey`'s
// `cache()`. The normalization here (dedup + sort + join) builds a
// stable string key so the memo hits regardless of caller-side
// ordering or duplicates — per PR #79 Copilot review (the previous
// version handed an array to cache(), which keys by identity, so
// equivalent calls didn't dedupe).
export async function getPublicProfilesByUids(
  uids: readonly string[],
): Promise<Map<string, PublicProfile>> {
  // De-dup, drop empties / non-strings, and sort so two callers that
  // pass `[a, b]` and `[b, a, a]` collapse to the same cache key.
  const unique = Array.from(
    new Set(uids.filter((u): u is string => !!u && typeof u === "string")),
  ).sort();
  // Uids never contain commas (Firebase uids are base62-ish), so a bare
  // comma join is unambiguous. Empty set short-circuits before hitting
  // the cache so we don't pollute it with a useless "" entry.
  if (unique.length === 0) return new Map();
  return _getPublicProfilesByKey(unique.join(","));
}

// Convenience helper for the single-author case. Wraps the batch helper
// so a one-uid call still hits the same per-request cache as a
// list-page batch that includes the same uid.
export async function getPublicProfileCached(
  uid: string,
): Promise<PublicProfile | null> {
  const map = await getPublicProfilesByUids([uid]);
  return map.get(uid) ?? null;
}
