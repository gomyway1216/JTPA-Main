import "server-only";

/**
 * Cache tags shared between the public-content data cache
 * (src/lib/data/cached.ts) and the server actions that mutate that
 * content. Every route under [locale] renders dynamically (the root
 * layout reads the session cookie), so there is no full-route cache —
 * these tags only govern `unstable_cache` data entries.
 *
 * Tagging scheme:
 *
 * - Collection tags (`posts`, `guides`, …) are attached to EVERY cached
 *   read of that content type — list queries and per-slug detail docs
 *   alike. Invalidating a collection tag therefore wipes every cached
 *   surface for the type. Content mutations (create/edit/publish/delete)
 *   are rare, so blanket invalidation is the simple, safe default.
 *
 * - Entity tags (`post:<slug>`, …) are additionally attached to per-slug
 *   detail reads. High-frequency mutations that only touch one doc
 *   (like toggles bumping `likeCount`) invalidate just that entity so
 *   the list caches — the expensive multi-doc queries — survive.
 *
 * Locale-filtered public caches still share the same collection tags, so one
 * tag invalidation covers /ja/... and /en/... simultaneously — no per-locale
 * path enumeration needed.
 */
export const POSTS_TAG = "posts";
export const GUIDES_TAG = "guides";
export const PROJECTS_TAG = "projects";
export const EVENTS_TAG = "events";
export const SITE_PAGES_TAG = "site-pages";

export function postTag(slug: string): string {
  return `post:${slug}`;
}

export function guideTag(slug: string): string {
  return `guide:${slug}`;
}

export function projectTag(slug: string): string {
  return `project:${slug}`;
}

/**
 * Map a comments/likes `parentType` to the entity tag of the cached
 * public detail doc, or `null` when that surface isn't cached (qa and
 * poll pages render fully dynamically and read Firestore directly).
 */
export function likeParentTag(
  parentType: "post" | "guide" | "qa" | "project" | "poll",
  slug: string,
): string | null {
  switch (parentType) {
    case "post":
      return postTag(slug);
    case "guide":
      return guideTag(slug);
    case "project":
      return projectTag(slug);
    default:
      return null;
  }
}
