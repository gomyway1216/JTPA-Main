import { beforeEach, describe, expect, it, vi } from "vitest";

// postComment validates input via Zod, checks parent visibility, and
// optionally validates a parentCommentId. The Firestore write is mostly
// choreography — focus tests on the input + authorization rules, plus
// the reply-parent validation that prevents thread-misattribution.

const requireUserMock = vi.fn();
const parentGetMock = vi.fn();
const parentCommentGetMock = vi.fn();
const commentSetMock = vi.fn();
const parentUpdateMock = vi.fn();
const newCommentRefId = "new-comment-id";

const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
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

import { postComment } from "@/app/actions/comments";

// postComment now returns a discriminated result instead of throwing —
// assert on the error result rather than a rejection.
async function expectError(
  p: ReturnType<typeof postComment>,
  substr: string,
) {
  const res = await p;
  if (res.ok) throw new Error("expected an error result, but got ok");
  expect(res.error).toContain(substr);
}

beforeEach(() => {
  requireUserMock.mockReset();
  parentGetMock.mockReset();
  parentCommentGetMock.mockReset();
  commentSetMock.mockReset().mockResolvedValue(undefined);
  parentUpdateMock.mockReset().mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
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
