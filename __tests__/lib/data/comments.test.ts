import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import { fetchCommentParentMetas, listComments } from "@/lib/data/comments";
import { decodePageCursor, encodePageCursor } from "@/lib/data/page-cursor";
import type { CommentParentType } from "@/lib/types";

beforeEach(() => {
  mock.reset();
});

function commentSnap(id: string, seconds: number) {
  return {
    id,
    data: () => ({
      authorUid: `author-${id}`,
      authorName: `Author ${id}`,
      authorPhotoURL: null,
      body: `body of ${id}`,
      createdAt: new Timestamp(seconds, 0),
      updatedAt: new Timestamp(seconds, 0),
    }),
  };
}

describe("listComments — cursor pagination", () => {
  it("queries the parent's comments subcollection in canonical page order", async () => {
    mock.setGet({ docs: [commentSnap("c1", 1), commentSnap("c2", 2)] });
    const page = await listComments("post", "p1", { pageSize: 10 });

    expect(mock.state.collection).toBe("posts/p1/comments");
    // (createdAt asc, doc id asc) — the doc-id tiebreak is what makes
    // the cursor total-ordered when two comments share a createdAt.
    expect(mock.state.orderByCalls).toEqual([
      ["createdAt", "asc"],
      [FieldPath.documentId(), "asc"],
    ]);
    // Overfetch by one to detect whether another page exists.
    expect(mock.state.limit).toBe(11);
    // No cursor → no startAfter.
    expect(mock.state.startAfter).toBeUndefined();
    expect(page.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("returns nextCursor=null when the thread fits in one page", async () => {
    mock.setGet({ docs: [commentSnap("c1", 1), commentSnap("c2", 2)] });
    const page = await listComments("post", "p1", { pageSize: 2 });
    // Exactly pageSize docs back from a pageSize+1 query ⇒ end of
    // thread.
    expect(page.comments).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("drops the overfetched doc and emits a cursor for the last returned one", async () => {
    mock.setGet({
      docs: [commentSnap("c1", 1), commentSnap("c2", 2), commentSnap("c3", 3)],
    });
    const page = await listComments("post", "p1", { pageSize: 2 });
    expect(page.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    const decoded = decodePageCursor(page.nextCursor!);
    expect(decoded).toMatchObject({ id: "c2" });
    expect(decoded!.createdAt.seconds).toBe(2);
  });

  it("resumes after the decoded cursor position", async () => {
    mock.setGet({ docs: [commentSnap("c3", 3)] });
    const cursor = encodePageCursor(new Timestamp(2, 0), "c2")!;
    const page = await listComments("post", "p1", { pageSize: 2, cursor });
    // startAfter gets the (createdAt, id) pair, matching the two
    // orderBy clauses.
    expect(mock.state.startAfter).toEqual([new Timestamp(2, 0), "c2"]);
    expect(page.comments.map((c) => c.id)).toEqual(["c3"]);
    expect(page.nextCursor).toBeNull();
  });

  it("treats a malformed cursor as the first page instead of throwing", async () => {
    // Cursors arrive from the client; tampering must degrade, not 500.
    mock.setGet({ docs: [commentSnap("c1", 1)] });
    const page = await listComments("post", "p1", { cursor: "garbage!!" });
    expect(mock.state.startAfter).toBeUndefined();
    expect(page.comments).toHaveLength(1);
  });

  it("re-derives parent fields and defaults legacy gaps on returned docs", async () => {
    // Legacy comments may lack the denormalized parentType/parentId and
    // the later-added parentCommentId/likeCount fields — fromSnap fills
    // all of them so callers always get a well-formed doc.
    mock.setGet({ docs: [commentSnap("c1", 1)] });
    const page = await listComments("guide", "g9");
    expect(page.comments[0]).toMatchObject({
      id: "c1",
      parentType: "guide",
      parentId: "g9",
      parentCommentId: null,
      likeCount: 0,
    });
  });
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
