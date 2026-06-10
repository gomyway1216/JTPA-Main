import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { siteBaseUrl } from "@/lib/site";

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.SITE_URL;
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

  it("prefers the server-only SITE_URL over NEXT_PUBLIC_SITE_URL", () => {
    process.env.SITE_URL = "https://runtime.test";
    process.env.NEXT_PUBLIC_SITE_URL = "https://buildtime.test";
    expect(siteBaseUrl()).toBe("https://runtime.test");
  });

  it("falls through to NEXT_PUBLIC_SITE_URL when SITE_URL is empty", () => {
    process.env.SITE_URL = "";
    process.env.NEXT_PUBLIC_SITE_URL = "https://public.test";
    expect(siteBaseUrl()).toBe("https://public.test");
  });

  it("prepends https:// when the scheme is missing", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "example.test";
    expect(siteBaseUrl()).toBe("https://example.test");
  });

  it("prepends http:// for loopback hosts without a scheme", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "localhost:3000";
    expect(siteBaseUrl()).toBe("http://localhost:3000");

    process.env.NEXT_PUBLIC_SITE_URL = "127.0.0.1:8080";
    expect(siteBaseUrl()).toBe("http://127.0.0.1:8080");
  });

  it("reduces a value with a path/query/fragment to its origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test/foo/bar?x=1#y";
    expect(siteBaseUrl()).toBe("https://example.test");
  });

  it("preserves a non-default port", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test:8443/path";
    expect(siteBaseUrl()).toBe("https://example.test:8443");
  });

  it("trims surrounding whitespace before parsing", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "  https://example.test/  ";
    expect(siteBaseUrl()).toBe("https://example.test");
  });

  it("falls back to the production domain on an unparseable URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://%";
    expect(siteBaseUrl()).toBe("https://bayarea-ai.com");
  });
});
