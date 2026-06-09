import { beforeEach, describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";

import proxy, { config } from "@/proxy";

const middlewareMocks = vi.hoisted(() => {
  const intlProxy = vi.fn((request: NextRequest) => {
    const pathname = request.nextUrl.pathname;
    if (pathname !== "/ja" && !pathname.startsWith("/ja/") && pathname !== "/en" && !pathname.startsWith("/en/")) {
      const target = new URL(request.url);
      target.pathname = pathname === "/" ? "/ja" : `/ja${pathname}`;
      return new Response(null, {
        status: 307,
        headers: { location: target.toString() },
      });
    }
    return new Response(null, { headers: { "x-middleware-next": "1" } });
  });
  return {
    createMiddleware: vi.fn(() => intlProxy),
    intlProxy,
  };
});

vi.mock("next-intl/middleware", () => ({
  default: middlewareMocks.createMiddleware,
}));

function runProxy(pathname: string) {
  return proxy(new NextRequest(`https://example.com${pathname}`));
}

describe("proxy", () => {
  beforeEach(() => {
    middlewareMocks.intlProxy.mockClear();
  });

  it("configures next-intl to require locale prefixes for every locale", () => {
    expect(middlewareMocks.createMiddleware).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultLocale: "ja",
        localePrefix: "always",
        locales: ["ja", "en"],
      }),
    );
  });

  it.each([
    ["/", "https://example.com/ja"],
    ["/help", "https://example.com/ja/help"],
  ])(
    "redirects unprefixed paths to the default locale prefix: %s",
    (pathname, location) => {
      const response = runProxy(pathname);

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(location);
      expect(middlewareMocks.intlProxy).toHaveBeenCalledOnce();
    },
  );

  it.each(["/__/auth/handler", "/__/auth/iframe", "/__/firebase/init.json"])(
    "does not run the locale proxy on Firebase helper paths: %s",
    (pathname) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: pathname,
        }),
      ).toBe(false);
    },
  );

  it.each(["/ja", "/ja/help", "/en", "/en/help"])(
    "serves locale-prefixed paths without redirecting: %s",
    (pathname) => {
      const response = runProxy(pathname);

      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(middlewareMocks.intlProxy).toHaveBeenCalledOnce();
    },
  );
});
