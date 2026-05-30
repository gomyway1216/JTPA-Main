import { describe, expect, it } from "vitest";

import { isControlFlowDigest } from "@/lib/data/error-logs";

describe("isControlFlowDigest", () => {
  it("flags Next control-flow signals so they are NOT logged as errors", () => {
    // redirect() and notFound() surface through onRequestError but aren't
    // real failures — logging them would spam the table on every nav.
    expect(isControlFlowDigest("NEXT_REDIRECT;replace;/admin/events;303;")).toBe(
      true,
    );
    expect(isControlFlowDigest("NEXT_HTTP_ERROR_FALLBACK;404")).toBe(true);
    expect(isControlFlowDigest("NEXT_NOT_FOUND")).toBe(true);
  });

  it("treats genuine error digests (and absent digests) as loggable", () => {
    expect(isControlFlowDigest("1234567890abcdef")).toBe(false);
    expect(isControlFlowDigest(undefined)).toBe(false);
    expect(isControlFlowDigest(null)).toBe(false);
    expect(isControlFlowDigest("")).toBe(false);
  });
});
