import { afterEach, describe, expect, it, vi } from "vitest";

import { safeLoad } from "@/lib/data/safe-load";

describe("safeLoad", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { ok: true, data } when the loader resolves", async () => {
    const result = await safeLoad("things", async () => [1, 2, 3]);
    expect(result).toEqual({ ok: true, data: [1, 2, 3] });
  });

  it("passes through falsy data (0, empty list) as ok", async () => {
    // A count of 0 or an empty list is a *successful* read — only a
    // rejection may flip ok to false.
    await expect(safeLoad("count", async () => 0)).resolves.toEqual({
      ok: true,
      data: 0,
    });
    await expect(safeLoad("list", async () => [])).resolves.toEqual({
      ok: true,
      data: [],
    });
  });

  it("returns { ok: false } and logs when the loader rejects", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("firestore down");
    const result = await safeLoad("pending posts", () => Promise.reject(boom));
    expect(result).toEqual({ ok: false });
    // Log line mirrors the old inline handlers ("Failed to ... :", err) so
    // existing log searches keep working, with the label identifying the
    // failed section.
    expect(spy).toHaveBeenCalledWith("Failed to load pending posts:", boom);
  });

  it("returns { ok: false } when the loader throws synchronously", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = new Error("sync throw");
    const result = await safeLoad("events", () => {
      throw boom;
    });
    expect(result).toEqual({ ok: false });
    expect(spy).toHaveBeenCalledWith("Failed to load events:", boom);
  });

  it("never rejects, so Promise.all over sections cannot blow up the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const results = await Promise.all([
      safeLoad("a", async () => "ok"),
      safeLoad("b", () => Promise.reject(new Error("nope"))),
    ]);
    expect(results[0]).toEqual({ ok: true, data: "ok" });
    expect(results[1]).toEqual({ ok: false });
  });

  it("narrows the union: data is only reachable behind ok", async () => {
    const result = await safeLoad("count", async () => 42);
    // Type-level check exercised at runtime: accessing .data requires the
    // ok discriminant to be true.
    if (!result.ok) throw new Error("expected ok result");
    expect(result.data).toBe(42);
  });
});
