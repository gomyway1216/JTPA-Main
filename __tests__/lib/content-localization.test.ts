import { describe, expect, it } from "vitest";

import {
  initialContentLocales,
  normalizeContentLocales,
  preferredContentLocale,
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

  it("uses the requested locale for legacy docs without locale metadata", () => {
    expect(preferredContentLocale(undefined, "ja")).toBe("ja");
    expect(preferredContentLocale(undefined, "fr")).toBe("ja");
  });

  it("falls back to an available locale when the requested one is missing", () => {
    expect(preferredContentLocale(["ja", "en"], "en")).toBe("en");
    expect(preferredContentLocale(["ja"], "en")).toBe("ja");
    expect(preferredContentLocale([], "en")).toBeUndefined();
  });
});
