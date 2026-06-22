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

  it("defaults new content to the current supported locale", () => {
    expect(initialContentLocales(undefined, "en")).toEqual(["en"]);
    expect(initialContentLocales(undefined, "fr")).toEqual(["ja"]);
  });

  it("treats missing legacy locales as visible everywhere", () => {
    expect(contentMatchesLocale(undefined, "ja")).toBe(true);
    expect(contentMatchesLocale([], "en")).toBe(true);
  });

  it("matches only selected locales when the field is present", () => {
    expect(contentMatchesLocale(["ja"], "ja")).toBe(true);
    expect(contentMatchesLocale(["ja"], "en")).toBe(false);
  });
});
