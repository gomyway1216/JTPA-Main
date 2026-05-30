import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import proxy from "@/proxy";

const middlewareMocks = vi.hoisted(() => {
  const intlProxy = vi.fn(() => new Response(null, { headers: { "x-intl-proxy": "1" } }));
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
    vi.clearAllMocks();
  });

  it.each(["/ja", "/ja/help"])(
    "serves default-locale internal paths without redirecting: %s",
    (pathname) => {
      const response = runProxy(pathname);

      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBe("1");
      expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBe("ja");
      expect(middlewareMocks.intlProxy).not.toHaveBeenCalled();
    },
  );

  it("delegates other paths to next-intl middleware", () => {
    const response = runProxy("/en/help");

    expect(response.headers.get("x-intl-proxy")).toBe("1");
    expect(middlewareMocks.intlProxy).toHaveBeenCalledOnce();
  });
});
