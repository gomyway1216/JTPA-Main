import type { MetadataRoute } from "next";

import { CONTENT_LOCALES, type ContentLocale } from "@/lib/content-localization";
import { listEvents } from "@/lib/data/events";
import { listGuides } from "@/lib/data/guides";
import { listPublishedPosts } from "@/lib/data/posts";
import { listProjects } from "@/lib/data/projects";
import { MAINTAINER_PROFILE_PATH } from "@/lib/maintainer";
import {
  getPostContentLocales,
  getGuideContentLocales,
  getProjectContentLocales,
} from "@/lib/localized-content";
import { absoluteLocalizedUrl, localizedAlternates } from "@/lib/seo";
import type { TsLike } from "@/lib/types";
import { toDate } from "@/lib/utils";

// Metadata routes are cached at build time by default. Force per-request
// generation — matching the app-wide force-dynamic convention — so newly
// published content appears without a redeploy, so the server-only SITE_URL
// (see siteBaseUrl) is read at runtime, and so the CI build (which runs with
// placeholder Firebase env vars) never attempts a Firestore query.
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
  "/mailing-list",
  "/help",
  MAINTAINER_PROFILE_PATH,
];

// One sitemap entry per locale for `path` (localePrefix is "always", so
// every page URL carries /ja or /en), each entry listing the full hreflang
// alternate set — Google expects alternates to be reciprocal, self
// included.
function localizedEntries(
  path: string,
  lastModified?: TsLike,
  locales: readonly ContentLocale[] = CONTENT_LOCALES,
): MetadataRoute.Sitemap {
  const languages = localizedAlternates(path, locales[0], locales).languages;
  const date = toDate(lastModified) ?? undefined;
  return locales.map((locale) => ({
    url: absoluteLocalizedUrl(path, locale),
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
    ...posts.flatMap((p) =>
      localizedEntries(`/blog/${p.slug}`, p.updatedAt, getPostContentLocales(p)),
    ),
    ...guides.flatMap((g) =>
      localizedEntries(`/guide/${g.slug}`, g.updatedAt, getGuideContentLocales(g)),
    ),
    ...events
      // Members-only events redirect anonymous visitors (crawlers included)
      // to login — keep them out of the sitemap entirely.
      .filter((e) => e.visibility !== "members_only")
      .flatMap((e) => localizedEntries(`/events/${e.slug}`, e.updatedAt, ["ja"])),
    ...projects.flatMap((p) =>
      localizedEntries(
        `/showcase/${p.slug}`,
        p.updatedAt,
        getProjectContentLocales(p),
      ),
    ),
  ];
}
