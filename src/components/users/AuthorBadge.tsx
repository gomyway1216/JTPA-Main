import Link from "next/link";

import type { PublicProfile } from "@/lib/data/users";

interface Props {
  // The author's public profile, fetched server-side and passed down.
  // `null` means "we know there's a uid but the user doc is gone / was
  // never created (walk-in guest)" — render an unlinked @unknown
  // placeholder instead of crashing the surface.
  profile: PublicProfile | null;
  // Set false when the badge sits inside another interactive container
  // and a nested anchor would be invalid HTML. Defaults true.
  linkable?: boolean;
  size?: "sm" | "md";
}

// Single source of truth for the way a comment/post/project author is
// shown across the app: avatar (photo or initials circle) + `@username`,
// linked to the user's public profile. Real names are deliberately
// absent here — they only surface on /u/[uid] when the user has opted
// into `fullNamePublic`. Keeping this component name-agnostic means
// renaming a user (or flipping their full-name visibility) propagates
// to every list/detail surface on the next render, with no doc-level
// backfill needed.
//
// Role pills (Admin / Editor / Contributor) render inline after the
// username when the profile's `role` field is set — see RolePill below.
// The role is denormalized from Auth custom claims on every claim
// change AND on every sign-in bootstrap, so it stays in sync without
// per-render Auth lookups.
export function AuthorBadge({ profile, linkable = true, size = "sm" }: Props) {
  const avatarClass = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const initialClass = size === "sm" ? "text-[10px]" : "text-xs";

  const username = profile?.username ?? "unknown";
  // First Unicode code point — `slice(0,1)` would tear a surrogate pair
  // for emoji / non-BMP usernames (mirroring the same handling on the
  // /u/[uid] page's initials fallback). `?` covers the (theoretical)
  // empty-username case.
  const initial = ([...username][0] ?? "?").toUpperCase();

  const inner = (
    <>
      {profile?.photoURL ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={profile.photoURL}
          alt=""
          className={`${avatarClass} shrink-0 rounded-full object-cover`}
        />
      ) : (
        // Initials circle when no photo. Always-render (instead of the
        // old "nothing when missing" behavior) so every author row has a
        // visual anchor and badge widths stay consistent across the
        // list. Background neutral; text uses inherited color so dark
        // mode falls out of the parent.
        <span
          aria-hidden
          className={`${avatarClass} ${initialClass} shrink-0 inline-flex items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300`}
        >
          {initial}
        </span>
      )}
      <span>@{username}</span>
      {profile?.role && <RolePill role={profile.role} size={size} />}
    </>
  );

  if (profile && linkable) {
    return (
      <Link
        href={`/u/${profile.uid}`}
        className="inline-flex items-center gap-1.5 align-middle hover:text-zinc-700 hover:underline dark:hover:text-zinc-300"
      >
        {inner}
      </Link>
    );
  }
  // Either the profile is unknown (deleted user / guest) or the caller
  // explicitly disabled linking. Render plain text so the surface still
  // looks consistent without producing a broken or nested link.
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {inner}
    </span>
  );
}

// Small inline pill rendered next to the @username when the user has an
// elevated role. Three flavors that mirror the claim hierarchy:
// admin (rose) > editor (blue) > contributor (emerald). Only the
// HIGHEST role appears — the projection in `users.ts` already collapses
// to one, so we don't have to handle multi-role users here. `aria-label`
// spells out the role for screen readers; the visible text stays compact.
function RolePill({
  role,
  size,
}: {
  role: "admin" | "editor" | "contributor";
  size: "sm" | "md";
}) {
  const palette =
    role === "admin"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300"
      : role === "editor"
        ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300";
  const label =
    role === "admin" ? "Admin" : role === "editor" ? "Editor" : "Contributor";
  const sizeCls =
    size === "md"
      ? "text-[10px] px-1.5 py-0"
      : "text-[9px] px-1 py-0";
  return (
    <span
      aria-label={`role: ${label}`}
      className={`inline-flex items-center rounded border font-medium uppercase tracking-wide ${palette} ${sizeCls}`}
    >
      {label}
    </span>
  );
}
