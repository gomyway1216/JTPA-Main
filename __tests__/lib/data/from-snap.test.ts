import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fromSnap, type SnapLike } from "@/lib/data/from-snap";
import { PostDocSchema } from "@/lib/data/schemas";

// Stand-in for an Admin SDK Timestamp: a class instance the schemas must
// accept untouched (timestamp fields are deliberately not validated — see
// src/lib/data/schemas.ts).
class FakeTimestamp {
  constructor(
    public seconds: number,
    public nanoseconds: number,
  ) {}
}

function snap(id: string, data: unknown): SnapLike {
  return { id, ref: { path: `posts/${id}` }, data: () => data };
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fromSnap", () => {
  it("passes a valid doc through identically, without logging", () => {
    const ts = new FakeTimestamp(1, 0);
    const data = {
      slug: "hello",
      title: "Hello",
      excerpt: "hi",
      body: "body",
      tags: ["a", "b"],
      authorUid: "u1",
      authorName: "Alice",
      authorPhotoURL: null,
      status: "published",
      reviewerUid: null,
      likeCount: 3,
      createdAt: ts,
      updatedAt: ts,
    };
    const out = fromSnap<typeof data>(snap("p1", data), PostDocSchema, "posts");
    expect(out).toEqual(data);
    // Timestamp class instances must survive by reference so `plainify`
    // downstream serializes them exactly as before this layer existed.
    expect(out.createdAt).toBe(ts);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("accepts partial docs silently (missing fields are normal drift)", () => {
    // Older docs predate many fields (likeCount backfills etc.) and the
    // data-layer tests stub minimal docs — neither should warn.
    const data = { slug: "a", title: "A" };
    const out = fromSnap<typeof data>(snap("p1", data), PostDocSchema, "posts");
    expect(out).toEqual(data);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("logs once on an invalid doc and still returns the raw data", () => {
    const data = { slug: 123, tags: "not-an-array", title: "ok" };
    const out = fromSnap<typeof data>(snap("bad", data), PostDocSchema, "posts");
    // Warn-only contract: the raw object comes back exactly as the old
    // `snap.data() as T` cast would have returned it.
    expect(out).toBe(data);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = errorSpy.mock.calls[0][1] as {
      label: string;
      doc: string;
      issues: string[];
    };
    expect(payload.label).toBe("posts");
    expect(payload.doc).toBe("posts/bad");
    expect(payload.issues.some((i) => i.startsWith("slug:"))).toBe(true);
    expect(payload.issues.some((i) => i.startsWith("tags:"))).toBe(true);
  });

  it("keeps unknown fields (loose objects pass extras through)", () => {
    const data = { slug: "a", title: "A", futureField: { nested: true } };
    const out = fromSnap<typeof data>(snap("p1", data), PostDocSchema, "posts");
    expect(out.futureField).toEqual({ nested: true });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("falls back to the snapshot id when the stub has no ref", () => {
    // The data-layer test stubs ({ id, data: () => ... }) don't build a
    // DocumentReference; the log must still identify the doc.
    const out = fromSnap<{ slug: number }>(
      { id: "p9", data: () => ({ slug: 9 }) },
      PostDocSchema,
      "posts",
    );
    expect(out).toEqual({ slug: 9 });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const payload = errorSpy.mock.calls[0][1] as { doc: string };
    expect(payload.doc).toBe("p9");
  });
});
