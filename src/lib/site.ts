// Canonical public origin for building absolute URLs (metadataBase,
// sitemap.xml, robots.txt, JSON-LD). Reads NEXT_PUBLIC_SITE_URL — the same
// convention `src/lib/notifications.ts` uses for email links — but unlike
// the mail paths (where a relative link is still readable), crawlers need
// a fully qualified URL, so we fall back to the production apex domain
// (see docs/deployment.md) instead of "".
const FALLBACK_SITE_URL = "https://bayarea-ai.com";

export function siteBaseUrl(): string {
  // `||` (not `??`) so an empty-string env var also falls back, and the
  // trailing-slash strip keeps `${siteBaseUrl()}${path}` joins clean.
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || FALLBACK_SITE_URL
  );
}
