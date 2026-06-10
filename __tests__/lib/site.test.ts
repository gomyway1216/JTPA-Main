import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { siteBaseUrl } from "@/lib/site";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("siteBaseUrl", () => {
  it("returns NEXT_PUBLIC_SITE_URL with trailing slashes stripped", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test/";
    expect(siteBaseUrl()).toBe("https://example.test");
  });

  it("falls back to the production domain when unset or empty", () => {
    expect(siteBaseUrl()).toBe("https://bayarea-ai.com");
    process.env.NEXT_PUBLIC_SITE_URL = "";
    expect(siteBaseUrl()).toBe("https://bayarea-ai.com");
  });
});
