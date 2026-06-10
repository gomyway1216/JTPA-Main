import { beforeEach, describe, expect, it, vi } from "vitest";

// postComment validates input via Zod, checks parent visibility, and
// optionally validates a parentCommentId. The Firestore write is mostly
// choreography — focus tests on the input + authorization rules, plus
// the reply-parent validation that prevents thread-misattribution.

const requireUserMock = vi.fn();
const getSessionUserMock = vi.fn();
const parentGetMock = vi.fn();
const parentCommentGetMock = vi.fn();
const commentSetMock = vi.fn();
const parentUpdateMock = vi.fn();
const newCommentRefId = "new-comment-id";

const revalidatePathMock = vi.fn();

// loadMoreComments delegates the actual reads to the data layer; mock
// those modules so these tests stay focused on the action's job —
// validation + the page-mirroring visibility rules.
const listCommentsMock = vi.fn();
const getMyLikesForParentMock = vi.fn();
const getPublicProfilesByUidsMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
  getSessionUser: () => getSessionUserMock(),
}));

vi.mock("@/lib/data/comments", () => ({
  listComments: (...args: unknown[]) => listCommentsMock(...args),
}));

vi.mock("@/lib/data/likes", () => ({
  getMyLikesForParent: (...args: unknown[]) => getMyLikesForParentMock(...args),
}));

vi.mock("@/lib/data/users", () => ({
  getPublicProfilesByUids: (...args: unknown[]) =>
    getPublicProfilesByUidsMock(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__server_ts__" },
  Timestamp: {
    now: () => ({ __fixed: "now" }),
  },
}));

vi.mock("@/lib/firebase/admin", () => {
  // Build the parent ref / comments subcollection chain the action
  // walks: collection(parents).doc(parentId).{get, update, collection(comments).doc(...).{get, set}}.
  function commentsCollection() {
    return {
      doc: (id?: string) => {
        if (id === undefined) {
          // No id → auto-id'd new comment ref.
          return {
            id: newCommentRefId,
            set: (...args: unknown[]) => commentSetMock(...args),
          };
        }
        return {
          id,
          get: () => parentCommentGetMock(),
        };
      },
    };
  }
  function parentDoc() {
    return {
      get: () => parentGetMock(),
      update: (...args: unknown[]) => parentUpdateMock(...args),
      collection: (name: string) =>
        name === "comments" ? commentsCollection() : null,
    };
  }
  return {
    adminDb: () => ({
      collection: () => ({ doc: () => parentDoc() }),
    }),
  };
});

import { loadMoreComments, postComment } from "@/app/actions/comments";

// The comment actions return discriminated results instead of throwing —
// assert on the error result rather than a rejection.
async function expectError(
  p: Promise<{ ok: true } | { ok: false; error: string }>,
  substr: string,
) {
  const res = await p;
  if (res.ok) throw new Error("expected an error result, but got ok");
  expect(res.error).toContain(substr);
}

beforeEach(() => {
  requireUserMock.mockReset();
  getSessionUserMock.mockReset().mockResolvedValue(null);
  parentGetMock.mockReset();
  parentCommentGetMock.mockReset();
  commentSetMock.mockReset().mockResolvedValue(undefined);
  parentUpdateMock.mockReset().mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
  listCommentsMock
    .mockReset()
    .mockResolvedValue({ comments: [], nextCursor: null });
  getMyLikesForParentMock.mockReset().mockResolvedValue(new Set<string>());
  getPublicProfilesByUidsMock.mockReset().mockResolvedValue(new Map());
  requireUserMock.mockResolvedValue({
    uid: "u1",
    displayName: "Alice",
    photoURL: "https://x/a.png",
    email: "alice@x",
    isAdmin: false,
    isEditor: false,
  });
});

describe("postComment — Zod validation", () => {
  it("rejects unknown parentType (slipping past the union type)", async () => {
    await expectError(
      postComment({
        parentType: "spam" as never,
        parentId: "p1",
        body: "hi",
      }),
      "入力エラー",
    );
  });

  it("rejects an empty body", async () => {
    await expectError(
      postComment({ parentType: "post", parentId: "p1", body: "" }),
      "入力エラー",
    );
  });

  it("rejects a body that's all whitespace (trim+min(1))", async () => {
    await expectError(
      postComment({ parentType: "post", parentId: "p1", body: "   " }),
      "入力エラー",
    );
  });

  it("rejects a body over 2000 chars", async () => {
    await expectError(
      postComment({
        parentType: "post",
        parentId: "p1",
        body: "x".repeat(2001),
      }),
      "入力エラー",
    );
  });

  it("rejects an empty parentId", async () => {
    await expectError(
      postComment({ parentType: "post", parentId: "", body: "hi" }),
      "入力エラー",
    );
  });
});

describe("postComment — parent existence + visibility", () => {
  it("returns an error when the parent doc is missing", async () => {
    parentGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(
      postComment({ parentType: "post", parentId: "p1", body: "hi" }),
      "見つかりません",
    );
  });

  it("refuses to post on an unpublished post (rules-bypass guard)", async () => {
    // Server Actions go through the Admin SDK, which bypasses
    // Firestore rules. Re-check parent visibility here so an admin
    // bug elsewhere can't let comments leak onto a draft.
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "draft", slug: "p1" }),
    });
    await expectError(
      postComment({ parentType: "post", parentId: "p1", body: "hi" }),
      "公開済み",
    );
    expect(commentSetMock).not.toHaveBeenCalled();
  });

  it("treats 'approved' as the visible status for projects (not 'published')", async () => {
    // Projects use the moderation-queue terminology. A misconfigured
    // 'published' project should NOT accept comments.
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "x" }),
    });
    await expectError(
      postComment({ parentType: "project", parentId: "p1", body: "hi" }),
      "公開済み",
    );
  });

  it("accepts a comment on a published post", async () => {
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "hello" }),
    });
    const res = await postComment({
      parentType: "post",
      parentId: "p1",
      body: "great post",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.comment).toMatchObject({
        id: newCommentRefId,
        parentType: "post",
        parentId: "p1",
        authorUid: "u1",
        body: "great post",
        parentCommentId: null,
        likeCount: 0,
      });
    }
    expect(commentSetMock).toHaveBeenCalledTimes(1);
  });

  it("revalidates the parent route using the canonical slug from Firestore", async () => {
    // Don't trust the caller for the path — use whatever slug is on
    // the parent doc.
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "real-slug" }),
    });
    await postComment({
      parentType: "post",
      parentId: "p1",
      body: "hi",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/blog/real-slug");
  });
});

describe("postComment — replies (parentCommentId)", () => {
  it("validates the parent comment exists under the SAME parent", async () => {
    // The reply guard stops a malicious client from threading their
    // comment to a parentCommentId that lives under a different post.
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "x" }),
    });
    parentCommentGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(
      postComment({
        parentType: "post",
        parentId: "p1",
        body: "reply",
        parentCommentId: "stranger-comment",
      }),
      "返信先のコメント",
    );
  });

  it("accepts a reply when the parent comment exists under this parent", async () => {
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "x" }),
    });
    parentCommentGetMock.mockResolvedValueOnce({ exists: true });
    const res = await postComment({
      parentType: "post",
      parentId: "p1",
      body: "reply",
      parentCommentId: "c-original",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.comment.parentCommentId).toBe("c-original");
  });

  it("treats parentCommentId=null as a top-level comment", async () => {
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "x" }),
    });
    const res = await postComment({
      parentType: "post",
      parentId: "p1",
      body: "top level",
      parentCommentId: null,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.comment.parentCommentId).toBeNull();
    // The parent-comment existence check is skipped — no validation
    // call.
    expect(parentCommentGetMock).not.toHaveBeenCalled();
  });
});

describe("postComment — author denormalization", () => {
  it("denormalizes authorUid / authorName / authorPhotoURL onto the comment", async () => {
    // Reading comments must not require a second roundtrip per author
    // for name+avatar — denormalize at write time.
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "x" }),
    });
    const res = await postComment({
      parentType: "post",
      parentId: "p1",
      body: "hi",
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.comment.authorUid).toBe("u1");
      expect(res.comment.authorName).toBe("Alice");
      expect(res.comment.authorPhotoURL).toBe("https://x/a.png");
    }
  });
});

// loadMoreComments is the read continuation of the server-rendered first
// page. Unlike postComment it must NOT require a session — but it must
// apply the exact same visibility rules as the detail pages, returning
// the not-found error (never the unpublished one) so it doesn't leak
// whether a hidden doc exists.

function sessionUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: "u1",
    displayName: "Alice",
    photoURL: null,
    email: "alice@x",
    isAdmin: false,
    isEditor: false,
    ...overrides,
  };
}

describe("loadMoreComments — validation", () => {
  it("rejects an empty cursor (first page is always server-rendered)", async () => {
    await expectError(
      loadMoreComments({ parentType: "post", parentId: "p1", cursor: "" }),
      "入力エラー",
    );
    expect(listCommentsMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown parentType", async () => {
    await expectError(
      loadMoreComments({
        parentType: "spam" as never,
        parentId: "p1",
        cursor: "abc",
      }),
      "入力エラー",
    );
  });
});

describe("loadMoreComments — visibility (mirrors the detail pages)", () => {
  it("returns not-found when the parent doc is missing", async () => {
    parentGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(
      loadMoreComments({ parentType: "post", parentId: "p1", cursor: "c" }),
      "見つかりません",
    );
    expect(listCommentsMock).not.toHaveBeenCalled();
  });

  it("hides a draft post behind the same not-found error (no existence leak)", async () => {
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "draft", authorUid: "u1" }),
    });
    await expectError(
      loadMoreComments({ parentType: "post", parentId: "p1", cursor: "c" }),
      "見つかりません",
    );
    expect(listCommentsMock).not.toHaveBeenCalled();
  });

  it("hides a draft post even from its author (the blog page 404s drafts for everyone)", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser({ uid: "u1" }));
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "draft", authorUid: "u1" }),
    });
    await expectError(
      loadMoreComments({ parentType: "post", parentId: "p1", cursor: "c" }),
      "見つかりません",
    );
  });

  it("serves a published post to an anonymous viewer", async () => {
    // getSessionUser default → null (anonymous).
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "x" }),
    });
    // A non-empty page so the companion lookups actually run (an empty
    // page short-circuits them — covered separately below).
    listCommentsMock.mockResolvedValue({
      comments: [{ id: "c1", authorUid: "a1" }],
      nextCursor: null,
    });
    const res = await loadMoreComments({
      parentType: "post",
      parentId: "p1",
      cursor: "c",
    });
    expect(res.ok).toBe(true);
    // Like-state lookup runs in the anonymous mode (uid: null), exactly
    // like the page's first-page read.
    expect(getMyLikesForParentMock).toHaveBeenCalledWith(
      expect.objectContaining({ uid: null }),
    );
  });

  it("treats 'approved' as the visible status for projects", async () => {
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published" }),
    });
    await expectError(
      loadMoreComments({ parentType: "project", parentId: "p1", cursor: "c" }),
      "見つかりません",
    );
  });

  it("serves an unpublished QA item to its author", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser({ uid: "author-1" }));
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "archived", authorUid: "author-1" }),
    });
    const res = await loadMoreComments({
      parentType: "qa",
      parentId: "q1",
      cursor: "c",
    });
    expect(res.ok).toBe(true);
  });

  it("hides an unpublished QA item from other signed-in users", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser({ uid: "someone-else" }));
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "archived", authorUid: "author-1" }),
    });
    await expectError(
      loadMoreComments({ parentType: "qa", parentId: "q1", cursor: "c" }),
      "見つかりません",
    );
  });

  it("serves an unpublished poll to an admin", async () => {
    getSessionUserMock.mockResolvedValue(
      sessionUser({ uid: "adm", isAdmin: true }),
    );
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "draft", authorUid: "author-1" }),
    });
    const res = await loadMoreComments({
      parentType: "poll",
      parentId: "pl1",
      cursor: "c",
    });
    expect(res.ok).toBe(true);
  });

  it("serves an unpublished guide to an editor (guides are curator-visible)", async () => {
    getSessionUserMock.mockResolvedValue(
      sessionUser({ uid: "ed", isEditor: true }),
    );
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "pending", authorUid: "author-1" }),
    });
    const res = await loadMoreComments({
      parentType: "guide",
      parentId: "g1",
      cursor: "c",
    });
    expect(res.ok).toBe(true);
  });

  it("falls back to createdBy.uid for legacy guides without authorUid", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser({ uid: "legacy-owner" }));
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "draft", createdBy: { uid: "legacy-owner" } }),
    });
    const res = await loadMoreComments({
      parentType: "guide",
      parentId: "g1",
      cursor: "c",
    });
    expect(res.ok).toBe(true);
  });
});

describe("loadMoreComments — page passthrough", () => {
  it("forwards the cursor to listComments and returns the page + companion data", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser({ uid: "viewer" }));
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "x" }),
    });
    const comment = {
      id: "c51",
      parentType: "post",
      parentId: "p1",
      authorUid: "author-9",
      authorName: "Nine",
      authorPhotoURL: null,
      body: "hello",
      parentCommentId: null,
      likeCount: 2,
      createdAt: { _seconds: 51, _nanoseconds: 0 },
      updatedAt: { _seconds: 51, _nanoseconds: 0 },
    };
    listCommentsMock.mockResolvedValue({
      comments: [comment],
      nextCursor: "CURSOR-2",
    });
    getMyLikesForParentMock.mockResolvedValue(new Set(["comment:c51"]));
    const profile = { uid: "author-9", username: "nine" };
    getPublicProfilesByUidsMock.mockResolvedValue(
      new Map([["author-9", profile]]),
    );

    const res = await loadMoreComments({
      parentType: "post",
      parentId: "p1",
      cursor: "CURSOR-1",
    });

    expect(listCommentsMock).toHaveBeenCalledWith("post", "p1", {
      cursor: "CURSOR-1",
    });
    expect(getMyLikesForParentMock).toHaveBeenCalledWith({
      parentType: "post",
      parentId: "p1",
      commentIds: ["c51"],
      uid: "viewer",
    });
    expect(getPublicProfilesByUidsMock).toHaveBeenCalledWith(["author-9"]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.comments).toEqual([comment]);
      expect(res.nextCursor).toBe("CURSOR-2");
      expect(res.likedKeys).toEqual(["comment:c51"]);
      // Map → plain object so it survives the Server Action boundary.
      expect(res.profiles).toEqual({ "author-9": profile });
    }
  });

  it("short-circuits the companion lookups when the page comes back empty", async () => {
    // Every doc after the cursor was hard-deleted between fetches, so the
    // page is empty. We still surface the (possibly non-null) nextCursor
    // from listComments so paging keeps advancing, but skip the like /
    // profile reads — there are no comments to look them up for.
    getSessionUserMock.mockResolvedValue(sessionUser({ uid: "viewer" }));
    parentGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ status: "published", slug: "x" }),
    });
    listCommentsMock.mockResolvedValue({
      comments: [],
      nextCursor: "CURSOR-NEXT",
    });

    const res = await loadMoreComments({
      parentType: "post",
      parentId: "p1",
      cursor: "CURSOR-1",
    });

    expect(getMyLikesForParentMock).not.toHaveBeenCalled();
    expect(getPublicProfilesByUidsMock).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.comments).toEqual([]);
      expect(res.nextCursor).toBe("CURSOR-NEXT");
      expect(res.likedKeys).toEqual([]);
      expect(res.profiles).toEqual({});
    }
  });
});
