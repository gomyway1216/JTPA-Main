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
// text promised 3-20. Keep in lockstep with USERNAME_HELP_TEXT below
// — it's what the form surfaces to the user.
// Per PR #79 Copilot review (the original pattern allowed
// `foo__bar`/`foo--bar`, contradicting the doc comment).
export const USERNAME_REGEX =
  /^(?!.*[_-]{2})[a-z0-9][a-z0-9_-]{1,18}[a-z0-9]$/;

export const USERNAME_HELP_TEXT =
  "3〜20文字。半角英小文字・数字・ハイフン・アンダースコアのみ。先頭・末尾は英数字。区切り文字は連続不可。";

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

export function validateUsernameFormat(
  input: string,
): UsernameValidationError | null {
  const norm = normalizeUsername(input);
  if (!norm) return "empty";
  if (!USERNAME_REGEX.test(norm)) return "format";
  if (RESERVED_USERNAMES.has(norm)) return "reserved";
  // System-only prefixes (currently `user-`). Auto-generated default
  // handles live in this namespace, so allowing manual claims here
  // would let one user grab another user's auto-default by accident.
  // `defaultUsernameFor` doesn't go through this validator, so it
  // can still emit `user-XXXXXX` for its own use.
  for (const prefix of RESERVED_USERNAME_PREFIXES) {
    if (norm.startsWith(prefix)) return "reserved";
  }
  return null;
}

export function usernameErrorMessage(err: UsernameValidationError): string {
  switch (err) {
    case "empty":
      return "ユーザーネームを入力してください";
    case "format":
      return USERNAME_HELP_TEXT;
    case "reserved":
      // Single message covers both exact-name reservations (`admin`,
      // `login`, …) and prefix reservations (`user-…`) — the user
      // experience is the same: "pick another one". Mentioning the
      // prefix space explicitly would be over-sharing the system's
      // internal naming convention.
      return "このユーザーネームは予約済みです";
  }
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
