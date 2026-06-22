import { describe, expect, it } from "vitest";

import {
  contentMatchesLocale,
  initialContentLocales,
  normalizeContentLocales,
} from "@/lib/content-localization";

describe("content localization helpers", () => {
  it("normalizes supported locales and drops duplicates/unknown values", () => {
    expect(normalizeContentLocales(["en", "ja", "en", "fr"])).toEqual([
      "en",
      "ja",
    ]);
  });

  it("defaults new content to all supported locales", () => {
    expect(initialContentLocales(undefined)).toEqual(["ja", "en"]);
  });

  it("treats missing legacy locales as visible everywhere", () => {
    expect(contentMatchesLocale(undefined, "ja")).toBe(true);
  });

  it("matches only selected locales when the field is present", () => {
    expect(contentMatchesLocale(["ja"], "ja")).toBe(true);
    expect(contentMatchesLocale(["ja"], "en")).toBe(false);
    expect(contentMatchesLocale([], "en")).toBe(false);
  });
});
