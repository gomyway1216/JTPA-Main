import { describe, expect, it } from "vitest";

import { localizedPath, loginPath, safeRedirectPath } from "@/i18n/paths";

describe("localizedPath", () => {
  it("strips an existing locale prefix before applying the target locale", () => {
    expect(localizedPath("/ja/help", "en")).toBe("/en/help");
    expect(localizedPath("/en/help", "ja")).toBe("/ja/help");
    expect(localizedPath("/ja", "en")).toBe("/en");
    expect(localizedPath("/en", "ja")).toBe("/ja");
  });

  it("preserves search and hash suffixes while normalizing locale prefixes", () => {
    expect(localizedPath("/ja/help?tab=faq#top", "en")).toBe(
      "/en/help?tab=faq#top",
    );
    expect(localizedPath("/ja?from=nav", "en")).toBe("/en?from=nav");
    expect(localizedPath("/en#main", "ja")).toBe("/ja#main");
  });

  it("leaves relative paths unchanged", () => {
    expect(localizedPath("mailto:hello@example.com", "en")).toBe(
      "mailto:hello@example.com",
    );
  });
});

describe("safeRedirectPath", () => {
  it("normalizes localized redirect paths to the requested locale", () => {
    expect(safeRedirectPath("/ja/admin/events", "en")).toBe(
      "/en/admin/events",
    );
  });

  it("keeps redirect paths internal after locale stripping", () => {
    expect(safeRedirectPath("/en//example.com", "ja")).toBe("/ja");
  });
});

describe("loginPath", () => {
  it("uses the normalized localized redirect inside the localized login URL", () => {
    expect(loginPath("/ja/admin/events", "en")).toBe(
      "/en/login?redirect=%2Fen%2Fadmin%2Fevents",
    );
  });
});
