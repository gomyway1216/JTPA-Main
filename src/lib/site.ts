// Canonical public origin for building absolute URLs (metadataBase,
// sitemap.xml, robots.txt, JSON-LD). Crawlers need a fully qualified URL,
// so on any failure we fall back to the production apex domain (see
// docs/deployment.md) instead of "".
const FALLBACK_SITE_URL = "https://bayarea-ai.com";

// Loopback hosts default to http:// when the configured value omits a
// scheme; every other host defaults to https://.
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1)(?:[:/]|$)/i;
// A URL already carries a scheme when it starts with `<scheme>://`.
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Returns the canonical site origin — always a fully-qualified, scheme-bearing
 * URL with no trailing slash, path, query, or fragment (e.g.
 * `https://bayarea-ai.com`). Safe to pass to `new URL()`; never throws.
 *
 * Resolution order:
 * 1. `SITE_URL` — a server-only var. Unlike `NEXT_PUBLIC_*` (which Next.js
 *    inlines at `next build` time on the server too, freezing the value),
 *    this is read at runtime during dynamic rendering, so sitemap/robots
 *    (both `force-dynamic`) can pick up the real origin without a rebuild.
 * 2. `NEXT_PUBLIC_SITE_URL` — the existing convention (`src/lib/notifications.ts`,
 *    the QR check-in page) for backward compatibility.
 * 3. {@link FALLBACK_SITE_URL}.
 *
 * The configured value is normalized defensively so a missing scheme
 * (`bayarea-ai.com`), a trailing slash, or a stray path (`https://x.com/foo`)
 * can't produce a malformed `metadataBase` or wrong sitemap/robots URLs:
 * the scheme is prepended when absent and only the `.origin` is returned.
 */
export function siteBaseUrl(): string {
  // `||` (not `??`) so empty-string env vars also fall through.
  const raw = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return FALLBACK_SITE_URL;

  const trimmed = raw.trim();
  const withScheme = HAS_SCHEME.test(trimmed)
    ? trimmed
    : `${LOOPBACK_HOST.test(trimmed) ? "http" : "https"}://${trimmed}`;

  try {
    // `.origin` drops any path/query/fragment and the trailing slash, so
    // `${siteBaseUrl()}${path}` joins stay clean.
    return new URL(withScheme).origin;
  } catch {
    return FALLBACK_SITE_URL;
  }
}
