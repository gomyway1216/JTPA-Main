import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { siteBaseUrl } from "@/lib/site";

// Force per-request generation so the server-only SITE_URL (see
// siteBaseUrl) is read at runtime rather than baked into a build-time-cached
// robots.txt. Matches sitemap.ts.
export const dynamic = "force-dynamic";

// Login-gated surfaces that should never be crawled. Every page route
// lives under a locale prefix (localePrefix: "always"), but the bare paths
// are disallowed too because the i18n proxy redirects them to the default
// locale (e.g. /admin → /ja/admin). robots rules are prefix matches, so
// each entry also covers everything nested beneath it.
const PRIVATE_PATHS = ["/admin", "/my", "/login"];

export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        // /api is never locale-prefixed — it's excluded from the i18n
        // matcher in src/proxy.ts.
        "/api",
        ...PRIVATE_PATHS.flatMap((path) => [
          path,
          ...routing.locales.map((locale) => `/${locale}${path}`),
        ]),
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
