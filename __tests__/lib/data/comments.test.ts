import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import { fetchCommentParentMetas } from "@/lib/data/comments";
import type { CommentParentType } from "@/lib/types";

beforeEach(() => {
  mock.reset();
});

describe("fetchCommentParentMetas", () => {
  it("returns an empty Map for an empty input", async () => {
    // No refs to batch — must short-circuit without touching Firestore.
    const out = await fetchCommentParentMetas([]);
    expect(out.size).toBe(0);
  });

  it("dedupes identical (parentType, parentId) pairs before BatchGet", async () => {
    // A user with three liked comments under the same post must
    // produce exactly one Firestore read for that post.
    mock.setGetAll([
      {
        exists: true,
        id: "p1",
        data: () => ({ title: "Hello", slug: "hello" }),
      },
    ]);
    const out = await fetchCommentParentMetas([
      { parentType: "post", parentId: "p1" },
      { parentType: "post", parentId: "p1" },
      { parentType: "post", parentId: "p1" },
    ]);
    expect(out.size).toBe(1);
    expect(out.get("post:p1")).toEqual({
      parentType: "post",
      parentId: "p1",
      title: "Hello",
      slug: "hello",
    });
  });

  it("skips parents that no longer exist (graceful)", async () => {
    // Deleted parent → snapshot.exists === false; caller sees the
    // matching key as absent rather than throwing.
    mock.setGetAll([
      {
        exists: true,
        id: "p1",
        data: () => ({ title: "Live", slug: "live" }),
      },
      { exists: false },
    ]);
    const out = await fetchCommentParentMetas([
      { parentType: "post", parentId: "p1" },
      { parentType: "guide", parentId: "gone" },
    ]);
    expect(out.size).toBe(1);
    expect(out.has("post:p1")).toBe(true);
    expect(out.has("guide:gone")).toBe(false);
  });

  it("skips parents missing title or slug (legacy half-formed docs)", async () => {
    // Defensive: if a parent doc somehow has no title or no slug we
    // can't render a useful link, so omit it.
    mock.setGetAll([
      {
        exists: true,
        id: "p1",
        data: () => ({ title: "no-slug" }),
      },
      {
        exists: true,
        id: "p2",
        data: () => ({ slug: "no-title" }),
      },
    ]);
    const out = await fetchCommentParentMetas([
      { parentType: "post", parentId: "p1" },
      { parentType: "guide", parentId: "p2" },
    ]);
    expect(out.size).toBe(0);
  });

  it("keys results by `${parentType}:${parentId}`", async () => {
    // Two different parent types with the same id must not collide —
    // the key prefix is what disambiguates them.
    mock.setGetAll([
      {
        exists: true,
        id: "X",
        data: () => ({ title: "post-X", slug: "post-x" }),
      },
      {
        exists: true,
        id: "X",
        data: () => ({ title: "guide-X", slug: "guide-x" }),
      },
    ]);
    const out = await fetchCommentParentMetas([
      { parentType: "post" as CommentParentType, parentId: "X" },
      { parentType: "guide" as CommentParentType, parentId: "X" },
    ]);
    expect(out.size).toBe(2);
    expect(out.get("post:X")?.slug).toBe("post-x");
    expect(out.get("guide:X")?.slug).toBe("guide-x");
  });
});
