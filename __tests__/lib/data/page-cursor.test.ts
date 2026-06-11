import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  decodePageCursor,
  encodePageCursor,
  slicePage,
} from "@/lib/data/page-cursor";

// The cursor crosses the server↔client boundary (Server Action arg,
// `?cursor=` query param), so decode must treat the input as hostile:
// anything that isn't a well-formed cursor comes back as null, never a
// throw. Encode is the trusted side — it only ever sees values read
// from Firestore snapshots.

describe("encodePageCursor / decodePageCursor", () => {
  it("round-trips an Admin SDK Timestamp + doc id", () => {
    const ts = new Timestamp(1717000000, 123456789);
    const cursor = encodePageCursor(ts, "abc123");
    expect(cursor).toBeTruthy();
    const decoded = decodePageCursor(cursor!);
    expect(decoded).not.toBeNull();
    expect(decoded!.id).toBe("abc123");
    expect(decoded!.createdAt.seconds).toBe(1717000000);
    expect(decoded!.createdAt.nanoseconds).toBe(123456789);
  });

  it("is URL-safe (base64url alphabet only)", () => {
    // The admin feedback page puts the cursor in a `?cursor=` link, so
    // the encoding must not contain `+`, `/`, or `=`.
    const cursor = encodePageCursor(new Timestamp(1, 2), "id-with_chars-09");
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("accepts a plainify'd Admin Timestamp ({_seconds,_nanoseconds})", () => {
    // After `plainify` (JSON round-trip) Timestamps lose their class and
    // keep only the underscored fields.
    const cursor = encodePageCursor({ _seconds: 42, _nanoseconds: 7 }, "x");
    const decoded = decodePageCursor(cursor!);
    expect(decoded!.createdAt.seconds).toBe(42);
    expect(decoded!.createdAt.nanoseconds).toBe(7);
  });

  it("accepts the client-SDK-style POJO ({seconds,nanoseconds}) and Date", () => {
    const fromPojo = encodePageCursor({ seconds: 9, nanoseconds: 0 }, "x");
    expect(decodePageCursor(fromPojo!)!.createdAt.seconds).toBe(9);

    const date = new Date("2026-01-02T03:04:05.678Z");
    const fromDate = encodePageCursor(date, "x");
    expect(decodePageCursor(fromDate!)!.createdAt.toDate().toISOString()).toBe(
      "2026-01-02T03:04:05.678Z",
    );
  });

  it("refuses to encode unusable input", () => {
    // Legacy doc missing createdAt → no cursor (pagination just stops)
    expect(encodePageCursor(undefined, "id")).toBeNull();
    expect(encodePageCursor("2026-01-01", "id")).toBeNull();
    // Empty / path-like ids can't be valid __name__ cursor values.
    expect(encodePageCursor(new Timestamp(1, 0), "")).toBeNull();
    expect(encodePageCursor(new Timestamp(1, 0), "a/b")).toBeNull();
    // Out-of-range parts would make `new Timestamp()` throw on decode.
    expect(
      encodePageCursor({ _seconds: 999999999999, _nanoseconds: 0 }, "id"),
    ).toBeNull();
  });

  it("returns null for garbage cursors instead of throwing", () => {
    for (const garbage of [
      "",
      "not-base64!!!",
      Buffer.from("plain text").toString("base64url"),
      Buffer.from(JSON.stringify({ s: 1, n: 2, id: "x" })).toString(
        "base64url",
      ), // object, not the array form
      Buffer.from(JSON.stringify([1, 2])).toString("base64url"), // arity
      Buffer.from(JSON.stringify(["1", 2, "x"])).toString("base64url"), // types
      Buffer.from(JSON.stringify([1.5, 2, "x"])).toString("base64url"), // non-int
      Buffer.from(JSON.stringify([1, 2, ""])).toString("base64url"), // empty id
      Buffer.from(JSON.stringify([1, 2, "a/b"])).toString("base64url"), // path id
      Buffer.from(JSON.stringify([999999999999, 0, "x"])).toString(
        "base64url",
      ), // seconds out of Timestamp range
      Buffer.from(JSON.stringify([1, 1_000_000_000, "x"])).toString(
        "base64url",
      ), // nanos out of range
    ]) {
      expect(decodePageCursor(garbage)).toBeNull();
    }
  });
});

describe("slicePage", () => {
  function snap(id: string, seconds: number) {
    return {
      id,
      data: () => ({ createdAt: new Timestamp(seconds, 0) }),
    } as unknown as FirebaseFirestore.QueryDocumentSnapshot;
  }

  it("returns everything + null cursor when the result fits the page", () => {
    // Query overfetches pageSize+1; fewer docs back ⇒ this is the last
    // page.
    const { pageDocs, nextCursor } = slicePage([snap("a", 1), snap("b", 2)], 2);
    expect(pageDocs.map((d) => d.id)).toEqual(["a", "b"]);
    expect(nextCursor).toBeNull();
  });

  it("drops the overfetched doc and points the cursor at the last RETURNED doc", () => {
    const { pageDocs, nextCursor } = slicePage(
      [snap("a", 1), snap("b", 2), snap("c", 3)],
      2,
    );
    expect(pageDocs.map((d) => d.id)).toEqual(["a", "b"]);
    const decoded = decodePageCursor(nextCursor!);
    expect(decoded!.id).toBe("b");
    expect(decoded!.createdAt.seconds).toBe(2);
  });

  it("handles an empty result", () => {
    const { pageDocs, nextCursor } = slicePage([], 2);
    expect(pageDocs).toEqual([]);
    expect(nextCursor).toBeNull();
  });

  it("exact page boundary: pageSize docs ⇒ last page, no cursor", () => {
    // Exactly pageSize docs back from a pageSize+1 query means the
    // collection ended precisely at the boundary — emitting a cursor
    // here would render a useless "load more" that fetches nothing.
    const { pageDocs, nextCursor } = slicePage(
      [snap("a", 1), snap("b", 2), snap("c", 3)],
      3,
    );
    expect(pageDocs).toHaveLength(3);
    expect(nextCursor).toBeNull();
  });
});
