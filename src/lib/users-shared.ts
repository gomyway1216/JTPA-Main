// Shared username + link helpers used by both server modules
// (read/write/bootstrap) and the client profile form. No `server-only`
// import so the client can validate input live without a round-trip.

// Strictly 3–20 chars, lowercase alphanumerics + `_` / `-`. Excludes:
//   - leading/trailing separators (anchored `[a-z0-9]` at both ends)
//   - consecutive separators `__` / `--` / `_-` / `-_` anywhere (negative
//     lookahead at the start)
// so handles stay URL- and log-friendly. Min 3 enforced by the
// non-optional middle group (`{1,18}`) — without that, the previous
// `(?:...)?` form silently allowed single-char handles while the help
// text promised 3-20. Keep the localized form help text in lockstep
// with this regex.
// Per PR #79 Copilot review (the original pattern allowed
// `foo__bar`/`foo--bar`, contradicting the doc comment).
export const USERNAME_REGEX =
  /^(?!.*[_-]{2})[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/;

// Prefixes the system uses for auto-generated handles (currently just
// `user-<6 chars of uid>` via `defaultUsernameFor` below). Anyone
// claiming a handle that starts with one of these would risk
// collisions with someone else's default — including the literal
// case where `user-abcdef` is auto-shown for one user but explicitly
// claimable by another in the username form. So we block the whole
// prefix space from being explicitly typed. `defaultUsernameFor` is
// the only place that's allowed to emit handles starting with this
// prefix, and it bypasses `validateUsernameFormat`. Per the bug Yudai
// hit where typing `user-2ex7b4` (another user's auto-default) was
// reported as available.
export const RESERVED_USERNAME_PREFIXES: readonly string[] = ["user-"];

// Handles that must never become a username because they'd collide with a
// top-level route or admin surface. The match is exact (post-normalize) so
// "admin-stuff" is fine but "admin" itself is blocked.
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "login",
  "logout",
  "signin",
  "signup",
  "auth",
  "u",
  "my",
  "me",
  "profile",
  "settings",
  "blog",
  "qa",
  "poll",
  "polls",
  "showcase",
  "projects",
  "events",
  "guides",
  "help",
  "about",
  "anonymous",
  "unknown",
  "null",
  "undefined",
  "system",
  "support",
  "root",
  "owner",
]);

// Lowercases + trims. Caller-side normalization so the regex / reservation
// check / Firestore lookup all agree on a single canonical form.
export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export type UsernameValidationError =
  | "empty"
  | "format"
  | "reserved";

// Centralized reservation check — covers BOTH the exact-name
// `RESERVED_USERNAMES` set AND the namespace-style
// `RESERVED_USERNAME_PREFIXES` list. Exported so server actions can
// re-assert the same rule in their belt-and-suspenders checks without
// drifting from the form-side validation (per PR #94 Gemini review,
// which spotted that `updateMyProfile` only checked the exact-name
// set and would have happily accepted a `user-*` handle on a
// hand-rolled payload that skipped `validateUsernameFormat`).
//
// Input is expected to be pre-normalized (lowercased + trimmed); the
// helper does NOT re-normalize so the call sites stay explicit about
// when normalization happens.
export function isReservedUsername(normalized: string): boolean {
  if (RESERVED_USERNAMES.has(normalized)) return true;
  return RESERVED_USERNAME_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix),
  );
}

export function validateUsernameFormat(
  input: string,
): UsernameValidationError | null {
  const norm = normalizeUsername(input);
  if (!norm) return "empty";
  if (!USERNAME_REGEX.test(norm)) return "format";
  if (isReservedUsername(norm)) return "reserved";
  return null;
}

// Deterministic fallback username derived from the uid. Used both on
// first-login bootstrap and as a backfill for older accounts that
// pre-date the `username` field. Length stays well within USERNAME_REGEX
// (5 + 6 = 11 chars). `user-` prefix avoids matching `RESERVED_USERNAMES`
// (which contains "u" alone, not "user").
export function defaultUsernameFor(uid: string): string {
  // Lowercase the slice — Firebase uids can include uppercase chars,
  // which would otherwise fail USERNAME_REGEX.
  return `user-${uid.slice(0, 6).toLowerCase()}`;
}

// A user who has never explicitly claimed a handle has no stored
// `username` — `signInWithIdToken` bootstraps the profile doc WITHOUT one
// (see src/app/actions/auth.ts), leaving the `usernames/{handle}`
// reservation slot free and letting the public projection fall back to
// `defaultUsernameFor(uid)` for display. The profile form still has to
// show something editable, so it pre-fills that same default placeholder.
//
// The catch: that placeholder lives in the reserved `user-` namespace. So
// when such a user saves their profile WITHOUT touching the username field
// (e.g. just toggling email opt-in or adding a LinkedIn URL), the
// submitted handle is a reserved one that doesn't match their stored
// username (which is absent) — and `updateMyProfile` rejected it as a
// forbidden claim with a reserved-username error (issue #104).
//
// This helper recognizes that exact no-op: stored handle absent AND the
// desired handle is precisely this user's own default. Callers treat it as
// "username unchanged" — no reservation write, and the `username` field
// stays absent. `desiredUsername` is expected pre-normalized (lowercased +
// trimmed), matching the other username helpers here.
export function isUnclaimedDefaultUsername(
  uid: string,
  currentUsername: string | null | undefined,
  desiredUsername: string,
): boolean {
  return !currentUsername && desiredUsername === defaultUsernameFor(uid);
}

// ---------- link host detection ----------

// Maps a URL string to a SNS platform key for icon rendering on
// /u/[uid]. Returns "generic" for anything we don't recognize or for
// inputs that aren't parseable URLs. Kept here (not in the icon
// component) so server-side render can pick the right icon without
// hydrating client JS.
export type SnsPlatform =
  | "x"
  | "instagram"
  | "threads"
  | "bluesky"
  | "mastodon"
  | "tiktok"
  | "facebook"
  | "youtube"
  | "generic";

export function detectSnsPlatform(url: string): SnsPlatform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "generic";
  }
  // Strip a leading "www." so twitter.com and www.twitter.com match.
  const h = host.startsWith("www.") ? host.slice(4) : host;
  if (h === "twitter.com" || h === "x.com") return "x";
  if (h === "instagram.com") return "instagram";
  if (h === "threads.net" || h === "threads.com") return "threads";
  if (h === "bsky.app") return "bluesky";
  // Mastodon is federated — any host whose path looks like /@user is a
  // good signal, but we can only see the host here. Match the common
  // flagships + the *.social tail; anything else falls through to
  // generic, which still renders fine.
  if (
    h === "mastodon.social" ||
    h === "mastodon.online" ||
    h === "mstdn.jp" ||
    h.endsWith(".mastodon.social") ||
    h.endsWith(".mstdn.social")
  ) {
    return "mastodon";
  }
  if (h === "tiktok.com") return "tiktok";
  if (h === "facebook.com" || h === "fb.com") return "facebook";
  if (h === "youtube.com" || h === "youtu.be") return "youtube";
  return "generic";
}

// ---------- avatar asset validation ----------

// Validate that an avatar Storage path belongs to `uid` and is a single
// direct child of their folder. Defends `updateMyAvatar` against a forged
// `path` that escapes `users/{uid}/` or tries to traverse/nest (`..`,
// extra `/` or `\`). The real uploader only ever writes
// `users/{uid}/avatar-{ts}-{file}` (see uploadUserAvatar), so a flat single
// segment is the entire valid surface.
export function isOwnedAvatarPath(uid: string, path: string): boolean {
  const prefix = `users/${uid}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return (
    rest.length > 0 &&
    !rest.includes("/") &&
    !rest.includes("\\") &&
    !rest.includes("..")
  );
}

// Validate that an avatar download URL is the canonical Firebase Storage
// URL for `path` in `bucket` — NOT an attacker-controlled host. Without
// this, a forged `url` would be persisted and served to everyone who views
// the user's profile / comments / header (an arbitrary content + tracking
// channel). Mirrors the shape `publicDownloadUrl` builds in
// src/lib/firebase/uploads.ts:
//   `{proto}://{host}/v0/b/{bucket}/o/{encodeURIComponent(path)}?alt=media`
// Allowed hosts: production (`firebasestorage.googleapis.com`) plus the
// local emulator (`localhost` / `127.0.0.1`, any port). The pathname is
// compared in its percent-encoded form (matching encodeURIComponent) so a
// `%2F` can't be smuggled past the path check by decoding to `/`.
export function isCanonicalAvatarUrl(
  url: string,
  bucket: string,
  path: string,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const protoOk = parsed.protocol === "https:" || parsed.protocol === "http:";
  const hostOk =
    parsed.hostname === "firebasestorage.googleapis.com" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1";
  const expectedPathname = `/v0/b/${bucket}/o/${encodeURIComponent(path)}`;
  return (
    protoOk &&
    hostOk &&
    parsed.pathname === expectedPathname &&
    parsed.searchParams.get("alt") === "media"
  );
}
