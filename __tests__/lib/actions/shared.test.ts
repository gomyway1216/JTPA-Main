import { beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

// (collection, candidate) => mocked QuerySnapshot for the slug probe.
const slugQueryMock = vi.fn();
// (path) => mocked Storage delete result.
const fileDeleteMock = vi.fn();
// Spy on the accessor itself so the empty-paths short-circuit is provable.
const adminStorageMock = vi.fn(() => ({
  bucket: () => ({
    file: (path: string) => ({ delete: () => fileDeleteMock(path) }),
  }),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: (name: string) => ({
      where: (_field: string, _op: string, candidate: string) => ({
        limit: () => ({ get: () => slugQueryMock(name, candidate) }),
      }),
    }),
  }),
  adminStorage: () => adminStorageMock(),
}));

import {
  deleteStoragePaths,
  findUniqueSlug,
  parseInput,
} from "@/lib/actions/shared";

const free = { empty: true, docs: [] };
const takenBy = (id: string) => ({ empty: false, docs: [{ id }] });

beforeEach(() => {
  slugQueryMock.mockReset();
  fileDeleteMock.mockReset();
  adminStorageMock.mockClear();
});

describe("parseInput", () => {
  const TestSchema = z.object({
    title: z.string().min(2),
    tags: z.array(z.string()).default([]),
  });

  it("returns ok:true with the parsed data (defaults applied)", async () => {
    const result = await parseInput(TestSchema, { title: "Hello" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ title: "Hello", tags: [] });
  });

  it("returns ok:false with a readable localized error naming the field", async () => {
    // Default-locale message: callers run without a next-intl request
    // context in unit tests, so action-errors falls back to ja.
    const result = await parseInput(TestSchema, { title: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("入力エラー");
      expect(result.error).toContain("title");
    }
  });

  it("translates sentinel messages via mapIssueMessage (qa.ts id regex)", async () => {
    const SENTINEL = "sentinelKey";
    const schema = z.object({ id: z.string().regex(/^[a-z]+$/, SENTINEL) });
    const result = await parseInput(schema, { id: "123" }, (message) =>
      message === SENTINEL ? "human readable" : message,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("human readable");
      expect(result.error).not.toContain(SENTINEL);
    }
  });
});

describe("findUniqueSlug", () => {
  it("returns the slugified base when it is free", async () => {
    slugQueryMock.mockResolvedValue(free);
    await expect(findUniqueSlug("posts", "My Title")).resolves.toBe("my-title");
    expect(slugQueryMock).toHaveBeenCalledTimes(1);
    expect(slugQueryMock).toHaveBeenCalledWith("posts", "my-title");
  });

  it("retries with a -1, -2, … counter until a candidate is free", async () => {
    slugQueryMock
      .mockResolvedValueOnce(takenBy("other-1"))
      .mockResolvedValueOnce(takenBy("other-2"))
      .mockResolvedValueOnce(free);
    await expect(findUniqueSlug("posts", "My Title")).resolves.toBe(
      "my-title-2",
    );
    expect(slugQueryMock).toHaveBeenNthCalledWith(2, "posts", "my-title-1");
  });

  it("treats a slug already owned by existingId as free (edit flow)", async () => {
    slugQueryMock.mockResolvedValue(takenBy("doc-1"));
    await expect(
      findUniqueSlug("posts", "My Title", { existingId: "doc-1" }),
    ).resolves.toBe("my-title");
  });

  it("falls back to a base36-timestamp suffix after 20 collisions", async () => {
    slugQueryMock.mockResolvedValue(takenBy("other"));
    const slug = await findUniqueSlug("posts", "My Title");
    expect(slugQueryMock).toHaveBeenCalledTimes(20);
    // Never one of the probed counter candidates — a timestamp suffix.
    expect(slug).toMatch(/^my-title-[0-9a-z]{6,}$/);
  });

  it("forwards the slugify fallback prefix for CJK-only titles", async () => {
    slugQueryMock.mockResolvedValue(free);
    const slug = await findUniqueSlug("qa", "日本語だけの題名", {
      prefix: "qa",
    });
    expect(slug).toMatch(/^qa-/);
  });

  it("honors custom attempts / retrySuffix / fallback (qa.ts strategy)", async () => {
    slugQueryMock.mockResolvedValue(takenBy("other"));
    const slug = await findUniqueSlug("qa", "My Question", {
      attempts: 4,
      retrySuffix: (base) => `${base}-${Date.now().toString(36)}`,
      fallback: (base) => `${base}-random`,
    });
    expect(slugQueryMock).toHaveBeenCalledTimes(4);
    // Retries 1-3 probed a timestamp suffix, not the counter default.
    const [, secondCandidate] = slugQueryMock.mock.calls[1] as [
      string,
      string,
    ];
    expect(secondCandidate).toMatch(/^my-question-[0-9a-z]+$/);
    expect(secondCandidate).not.toBe("my-question-1");
    expect(slug).toBe("my-question-random");
  });
});

describe("deleteStoragePaths", () => {
  it("short-circuits without touching Storage when there is nothing to delete", async () => {
    await deleteStoragePaths([]);
    expect(adminStorageMock).not.toHaveBeenCalled();
  });

  it("swallows individual failures, logs them, and still attempts every path", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    fileDeleteMock.mockImplementation((path: string) =>
      path === "b" ? Promise.reject(new Error("boom")) : Promise.resolve(),
    );
    // A single missing object must never block the caller's doc write.
    await expect(deleteStoragePaths(["a", "b", "c"])).resolves.toBeUndefined();
    expect(fileDeleteMock).toHaveBeenCalledTimes(3);
    expect(fileDeleteMock).toHaveBeenCalledWith("a");
    expect(fileDeleteMock).toHaveBeenCalledWith("b");
    expect(fileDeleteMock).toHaveBeenCalledWith("c");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toContain("b");
    warnSpy.mockRestore();
  });
});
