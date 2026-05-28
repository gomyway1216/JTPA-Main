import { beforeEach, describe, expect, it, vi } from "vitest";

// getMyLikesForParent does BatchGet chunking against Firestore. We
// don't go through the shared chainable mock here because we need to
// inspect chunk sizes — instead, mock adminDb() with a stub whose
// getAll() records the count of refs per call.

const getAllMock = vi.fn();

// Walk both shapes the helper builds:
//   parentRef.collection("likes").doc(uid)
//   parentRef.collection("comments").doc(cid).collection("likes").doc(uid)
// A deep self-referential stub is fine — each `doc()` returns an object
// with both `collection` (for further nesting) and a sentinel so the
// final ref is identifiable.
function deepDocRef(): unknown {
  const ref: { collection: (n: string) => unknown; __ref: true } = {
    __ref: true,
    collection: () => ({
      doc: () => deepDocRef(),
    }),
  };
  return ref;
}

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: () => ({
      doc: () => deepDocRef(),
    }),
    getAll: getAllMock,
  }),
}));

import { RECORD_LIKE_KEY, getMyLikesForParent } from "@/lib/data/likes";

beforeEach(() => {
  getAllMock.mockReset();
});

describe("getMyLikesForParent", () => {
  it("returns an empty set immediately for anonymous (uid === null)", async () => {
    // Anon visitors shouldn't trigger any Firestore reads.
    const out = await getMyLikesForParent({
      parentType: "post",
      parentId: "p1",
      commentIds: ["c1", "c2"],
      uid: null,
    });
    expect(out.size).toBe(0);
    expect(getAllMock).not.toHaveBeenCalled();
  });

  it("adds RECORD when the user has liked the parent itself", async () => {
    // First snap is the parent-level like ref; subsequent map 1:1 to
    // the commentIds passed in.
    getAllMock.mockResolvedValueOnce([
      { exists: true },
      { exists: false },
      { exists: true },
    ]);
    const out = await getMyLikesForParent({
      parentType: "post",
      parentId: "p1",
      commentIds: ["c1", "c2"],
      uid: "user-1",
    });
    expect(out.has(RECORD_LIKE_KEY)).toBe(true);
    expect(out.has("comment:c1")).toBe(false);
    expect(out.has("comment:c2")).toBe(true);
  });

  it("uses RECORD_LIKE_KEY === 'RECORD' (UI hard-codes this)", async () => {
    // Renaming the sentinel would silently break the UI's like-state
    // check. Lock in the literal value.
    expect(RECORD_LIKE_KEY).toBe("RECORD");
  });

  it("chunks BatchGet at the 99-ref cap (record + 98 comments per batch)", async () => {
    // Firestore caps BatchGet at 100 docs/req; the implementation
    // chunks at 99 so the parent-level ref always rides in the first
    // chunk without spilling.
    const commentIds = Array.from({ length: 250 }, (_, i) => `c${i}`);
    getAllMock.mockImplementation(async (...refs: unknown[]) => {
      return refs.map(() => ({ exists: false }));
    });

    await getMyLikesForParent({
      parentType: "post",
      parentId: "p1",
      commentIds,
      uid: "u1",
    });

    expect(getAllMock).toHaveBeenCalledTimes(3);
    // First chunk = record-like ref + 98 comment refs = 99 args.
    expect(getAllMock.mock.calls[0]).toHaveLength(99);
    // Second chunk = 99 comment refs.
    expect(getAllMock.mock.calls[1]).toHaveLength(99);
    // Third chunk = remaining 53 comment refs.
    expect(getAllMock.mock.calls[2]).toHaveLength(53);
  });

  it("maps comment-like results across chunks back to the original index", async () => {
    // 100 comments total → 2 chunks (99 + ... + 1 leftover comment).
    // We mark c0 (in chunk 0, index 1 after the record ref) and c99
    // (in chunk 1, index 0) as liked. Both should show up in the
    // returned set.
    const commentIds = Array.from({ length: 100 }, (_, i) => `c${i}`);
    // Chunk 0: record ref + c0..c97 (99 entries). Mark index 1 (c0).
    const chunk0 = commentIds.slice(0, 98).map(() => ({ exists: false }));
    chunk0[0] = { exists: true } as const; // c0
    getAllMock.mockResolvedValueOnce([{ exists: false }, ...chunk0]);
    // Chunk 1: c98, c99 (2 entries). Mark index 1 (c99).
    getAllMock.mockResolvedValueOnce([
      { exists: false },
      { exists: true },
    ]);

    const out = await getMyLikesForParent({
      parentType: "post",
      parentId: "p1",
      commentIds,
      uid: "u1",
    });
    expect(out.has("comment:c0")).toBe(true);
    expect(out.has("comment:c99")).toBe(true);
    // c50 was un-liked → not in the set.
    expect(out.has("comment:c50")).toBe(false);
  });
});
