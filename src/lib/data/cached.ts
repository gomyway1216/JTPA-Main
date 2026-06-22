import "server-only";

import { unstable_cache } from "next/cache";

import {
  EVENTS_TAG,
  GUIDES_TAG,
  POSTS_TAG,
  PROJECTS_TAG,
  SITE_PAGES_TAG,
  guideTag,
  postTag,
  projectTag,
} from "@/lib/data/cache-tags";
import { listEvents, listPastEvents } from "@/lib/data/events";
import { getGuideBySlug, listGuides } from "@/lib/data/guides";
import {
  getPostBySlug,
  listPublishedPosts,
  listPublishedPostsForLocale,
} from "@/lib/data/posts";
import { getProjectBySlug, listProjects } from "@/lib/data/projects";
import { readSitePage, type SitePageSlug } from "@/lib/data/site-pages";
import type { GuideDoc, PostDoc, ProjectDoc } from "@/lib/types";

/**
 * Cross-request data cache for PUBLIC, anonymous-identical Firestore
 * reads. Every route under [locale] is dynamically rendered (the root
 * layout reads the session cookie to draw the header), so route-level
 * ISR is off the table — `unstable_cache` is this Next version's lever
 * for caching data inside dynamic routes (see the "Caching and
 * Revalidating (Previous Model)" guide; `use cache` requires the
 * cacheComponents flag, which changes the whole app's rendering model).
 *
 * Only PUBLIC pages import these wrappers. Admin and /my surfaces keep
 * calling the raw data functions so dashboards and edit forms always
 * read fresh.
 *
 * Per-user reads (session, likes, RSVPs, profiles) and the interactive
 * social layer (comments) are intentionally NOT cached here.
 *
 * Freshness model (two layers):
 *
 * 1. On-demand: the server actions that mutate public content call
 *    `updateTag()` with the matching tag from cache-tags.ts, so the
 *    instance that handles the mutation drops its entries immediately
 *    (read-your-own-writes for authors/admins).
 * 2. Time-based: `revalidate` below bounds staleness on OTHER Cloud Run
 *    instances — tag invalidation is per-instance without a shared cache
 *    handler, so the windows are the worst-case staleness anywhere.
 *
 * Cached values must survive JSON round-trips; every function wrapped
 * here already returns `plainify()`d plain objects (no Timestamps, no
 * Maps), which is also why Map-returning helpers like
 * `getPublicProfilesByUids` are not wrapped.
 */

// Editorial content: changes only through explicit publish/edit actions,
// so a 5-minute worst-case window (mutating instance updates instantly)
// is a comfortable bound.
export const CONTENT_REVALIDATE_SECONDS = 300;

// Event lists are doubly time-sensitive: the queries themselves filter on
// Timestamp.now() (upcoming vs past) and the rendered cards show live-ish
// rsvpCount, which every RSVP/check-in bumps. Keep the window short.
export const EVENTS_REVALIDATE_SECONDS = 60;

// ---------------------------------------------------------------------------
// Posts (/blog, /blog/[slug], /community)
// ---------------------------------------------------------------------------

export const listPublishedPostsCached = unstable_cache(
  (limit: number) => listPublishedPosts(limit),
  ["public-posts-list"],
  { tags: [POSTS_TAG], revalidate: CONTENT_REVALIDATE_SECONDS },
);

export const listPublishedPostsForLocaleCached = unstable_cache(
  // Locale-specific call sites intentionally still receive the full public
  // list; renderers can fall back to any available content locale.
  (locale: string, limit: number) => listPublishedPostsForLocale(locale, limit),
  ["public-posts-list-by-locale"],
  { tags: [POSTS_TAG], revalidate: CONTENT_REVALIDATE_SECONDS },
);

export function getPostBySlugCached(slug: string): Promise<PostDoc | null> {
  // The wrapper is created per call so the entity tag can include the
  // slug (the `tags` option is fixed at wrap time). The cache key is
  // stable regardless: fn source + keyParts + JSON-serialized args.
  return unstable_cache(getPostBySlug, ["public-post-by-slug"], {
    tags: [POSTS_TAG, postTag(slug)],
    revalidate: CONTENT_REVALIDATE_SECONDS,
  })(slug);
}

// ---------------------------------------------------------------------------
// Guides (/guide, /guide/[slug])
// ---------------------------------------------------------------------------

export const listPublishedGuidesCached = unstable_cache(
  (limit: number) => listGuides({ statuses: ["published"], limit }),
  ["public-guides-list"],
  { tags: [GUIDES_TAG], revalidate: CONTENT_REVALIDATE_SECONDS },
);

// Note: like the raw function, this returns non-published guides too —
// the per-request authz check in /guide/[slug] (author/curator preview
// vs 404) runs on every request with a fresh session, so caching the doc
// itself leaks nothing.
export function getGuideBySlugCached(slug: string): Promise<GuideDoc | null> {
  return unstable_cache(getGuideBySlug, ["public-guide-by-slug"], {
    tags: [GUIDES_TAG, guideTag(slug)],
    revalidate: CONTENT_REVALIDATE_SECONDS,
  })(slug);
}

// ---------------------------------------------------------------------------
// Projects (/, /showcase, /showcase/[slug])
// ---------------------------------------------------------------------------

export const listApprovedProjectsCached = unstable_cache(
  // `listProjects` defaults to status "approved" — the only status public
  // surfaces render. Admin review queues call listProjects directly.
  (limit: number) => listProjects({ limit }),
  ["public-projects-list"],
  { tags: [PROJECTS_TAG], revalidate: CONTENT_REVALIDATE_SECONDS },
);

export const listApprovedProjectsForLocaleCached = unstable_cache(
  // Locale-specific call sites intentionally still receive the full public
  // list; renderers can fall back to any available content locale.
  (locale: string, limit: number) => listProjects({ limit, locale }),
  ["public-projects-list-by-locale"],
  { tags: [PROJECTS_TAG], revalidate: CONTENT_REVALIDATE_SECONDS },
);

export function getProjectBySlugCached(
  slug: string,
): Promise<ProjectDoc | null> {
  return unstable_cache(getProjectBySlug, ["public-project-by-slug"], {
    tags: [PROJECTS_TAG, projectTag(slug)],
    revalidate: CONTENT_REVALIDATE_SECONDS,
  })(slug);
}

// ---------------------------------------------------------------------------
// Events (/, /events) — event DETAIL (/events/[slug]) stays uncached on
// purpose: it gates members-only access, renders capacity ("12 / 20")
// that the RSVP form's full/waitlist branching builds on, and serves the
// check-in flow. Stale data there has user-visible consequences beyond a
// cosmetic count.
// ---------------------------------------------------------------------------

export const listUpcomingEventsCached = unstable_cache(
  (limit: number) => listEvents({ notEndedOnly: true, limit }),
  ["public-upcoming-events"],
  { tags: [EVENTS_TAG], revalidate: EVENTS_REVALIDATE_SECONDS },
);

export const listPastEventsCached = unstable_cache(
  (limit: number) => listPastEvents(limit),
  ["public-past-events"],
  { tags: [EVENTS_TAG], revalidate: EVENTS_REVALIDATE_SECONDS },
);

// ---------------------------------------------------------------------------
// Site pages (/about)
// ---------------------------------------------------------------------------

export const getSitePageCached = unstable_cache(
  (slug: SitePageSlug) => readSitePage(slug),
  ["public-site-page"],
  { tags: [SITE_PAGES_TAG], revalidate: CONTENT_REVALIDATE_SECONDS },
);
