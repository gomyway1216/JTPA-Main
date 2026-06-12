import { describe, expect, it, vi } from "vitest";

// site-pages.ts is server-only and reads from Firestore at module
// boundary via adminDb(). The exported defaults + slug allowlist are
// pure data, so stub the admin module to keep the import hermetic.
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: vi.fn(),
}));

import {
  SITE_PAGE_DEFAULTS,
  SITE_PAGE_SLUGS,
  type SitePageSlug,
} from "@/lib/data/site-pages";

describe("SITE_PAGE_SLUGS", () => {
  it("only contains the 'about' slug today", () => {
    // Adding a slug needs a paired entry in SITE_PAGE_DEFAULTS — the type
    // already requires it, and this test catches the runtime drift if a
    // dev edits one but not the other.
    expect(SITE_PAGE_SLUGS).toEqual(["about"]);
  });
});

describe("SITE_PAGE_DEFAULTS", () => {
  it.each(SITE_PAGE_SLUGS)(
    "ships non-empty title + body for slug '%s'",
    (slug: SitePageSlug) => {
      const entry = SITE_PAGE_DEFAULTS[slug];
      expect(entry.title.length).toBeGreaterThan(0);
      expect(entry.body.length).toBeGreaterThan(0);
    },
  );

  it("has exactly one defaults entry per allowlisted slug", () => {
    // Guards against orphan entries (slug removed from the union but
    // entry left behind) or missing entries.
    const slugSet = new Set<string>(SITE_PAGE_SLUGS);
    expect(Object.keys(SITE_PAGE_DEFAULTS).sort()).toEqual(
      [...slugSet].sort(),
    );
  });

  it("renders the about page with community-specific copy", () => {
    // The fallback content is shown to real users before an admin has
    // ever saved /about — must not be lorem ipsum.
    expect(SITE_PAGE_DEFAULTS.about.title).toBe("ベイエリアAI勉強会とは");
    expect(SITE_PAGE_DEFAULTS.about.body).toContain("JTPA");
  });
});
