import type { MetadataRoute } from "next";

import { localizedPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { listEvents } from "@/lib/data/events";
import { listGuides } from "@/lib/data/guides";
import { listPublishedPosts } from "@/lib/data/posts";
import { listProjects } from "@/lib/data/projects";
import { siteBaseUrl } from "@/lib/site";
import type { TsLike } from "@/lib/types";
import { toDate } from "@/lib/utils";

// Metadata routes are cached at build time by default. Force per-request
// generation — matching the app-wide force-dynamic convention — so newly
// published content appears without a redeploy, and so the CI build (which
// runs with placeholder Firebase env vars) never attempts a Firestore query.
export const dynamic = "force-dynamic";

// Public, always-present landing/listing pages. Detail URLs for blog /
// guide / events / showcase are appended from Firestore below. Login-gated
// surfaces (/admin, /my, /login) are excluded here and disallowed in
// robots.ts.
const STATIC_PATHS = [
  "/",
  "/about",
  "/events",
  "/blog",
  "/guide",
  "/showcase",
  "/qa",
  "/poll",
  "/community",
  "/help",
];

// One sitemap entry per locale for `path` (localePrefix is "always", so
// every page URL carries /ja or /en), each entry listing the full hreflang
// alternate set — Google expects alternates to be reciprocal, self
// included.
function localizedEntries(
  path: string,
  lastModified?: TsLike,
): MetadataRoute.Sitemap {
  const base = siteBaseUrl();
  const urlFor = (locale: string) => `${base}${localizedPath(path, locale)}`;
  const languages = Object.fromEntries(
    routing.locales.map((locale) => [locale, urlFor(locale)]),
  );
  const date = toDate(lastModified) ?? undefined;
  return routing.locales.map((locale) => ({
    url: urlFor(locale),
    lastModified: date,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Each Firestore read degrades to an empty list on failure so the
  // sitemap always serves at least the static URLs.
  const [posts, guides, events, projects] = await Promise.all([
    listPublishedPosts(500).catch(() => []),
    listGuides({ limit: 500 }).catch(() => []),
    listEvents({ statuses: ["published", "past"], limit: 500 }).catch(
      () => [],
    ),
    listProjects({ limit: 500 }).catch(() => []),
  ]);

  return [
    ...STATIC_PATHS.flatMap((path) => localizedEntries(path)),
    ...posts.flatMap((p) => localizedEntries(`/blog/${p.slug}`, p.updatedAt)),
    ...guides.flatMap((g) => localizedEntries(`/guide/${g.slug}`, g.updatedAt)),
    ...events
      // Members-only events redirect anonymous visitors (crawlers included)
      // to login — keep them out of the sitemap entirely.
      .filter((e) => e.visibility !== "members_only")
      .flatMap((e) => localizedEntries(`/events/${e.slug}`, e.updatedAt)),
    ...projects.flatMap((p) =>
      localizedEntries(`/showcase/${p.slug}`, p.updatedAt),
    ),
  ];
}
