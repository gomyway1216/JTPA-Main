import { beforeEach, describe, expect, it, vi } from "vitest";

// toggleLikeRecord / toggleLikeComment run their work inside a Firestore
// transaction. Mock `runTransaction` to execute the callback against a
// hand-rolled `tx` whose `.get()` returns scripted snapshots and whose
// `.set/.update/.delete` record the writes for assertion.

const requireUserMock = vi.fn();
const revalidatePathMock = vi.fn();

const txGetMock = vi.fn();
const txSetMock = vi.fn();
const txUpdateMock = vi.fn();
const txDeleteMock = vi.fn();

// Each test sets up a script for tx.get(): it's called in source order
// (likeRef first, then either parentRef or commentRef+parentRef). Tests
// push snapshot stubs onto this list and we shift them off.
let snapQueue: Array<{ exists: boolean; data?: () => unknown }> = [];

const runTransactionMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
  txGetMock.mockImplementation(async () => {
    const next = snapQueue.shift();
    if (!next) throw new Error("test bug: snapshot queue underflow");
    return next;
  });
  return await cb({
    get: txGetMock,
    set: txSetMock,
    update: txUpdateMock,
    delete: txDeleteMock,
  });
});

function deepDocRef(label: string): unknown {
  // toggleLike{Record,Comment} walk:
  //   parents().doc(id).collection("likes").doc(uid)
  //   parents().doc(id).collection("comments").doc(cid).collection("likes").doc(uid)
  return {
    __label: label,
    collection: (name: string) => ({
      doc: (id: string) => deepDocRef(`${label}/${name}/${id}`),
    }),
  };
}

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => ({ __fixed: "now" }) },
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: (name: string) => ({
      doc: (id: string) => deepDocRef(`${name}/${id}`),
    }),
    runTransaction: (cb: (tx: unknown) => Promise<unknown>) =>
      runTransactionMock(cb),
  }),
}));

import { toggleLikeComment, toggleLikeRecord } from "@/app/actions/likes";

// The toggles now return a discriminated result instead of throwing.
async function expectError(
  p: ReturnType<typeof toggleLikeRecord>,
  substr: string,
) {
  const res = await p;
  if (res.ok) throw new Error("expected an error result, but got ok");
  expect(res.error).toContain(substr);
}

beforeEach(() => {
  requireUserMock.mockReset().mockResolvedValue({ uid: "u1" });
  revalidatePathMock.mockReset();
  txGetMock.mockReset();
  txSetMock.mockReset();
  txUpdateMock.mockReset();
  txDeleteMock.mockReset();
  runTransactionMock.mockClear();
  snapQueue = [];
});

describe("toggleLikeRecord — validation", () => {
  it("rejects an unknown parentType", async () => {
    await expectError(
      toggleLikeRecord({ parentType: "spam" as never, parentId: "p1" }),
      "入力エラー",
    );
  });

  it("rejects an empty parentId", async () => {
    await expectError(
      toggleLikeRecord({ parentType: "post", parentId: "" }),
      "入力エラー",
    );
  });
});

describe("toggleLikeRecord — happy paths", () => {
  it("turns OFF when previously liked (decrement + delete the like doc)", async () => {
    // Both Promise.all() reads happen in parallel but their order in
    // the tx.get call sequence matters: likeRef first, then parentRef.
    snapQueue.push(
      { exists: true }, // likeRef — already liked
      {
        exists: true,
        data: () => ({ status: "published", slug: "hello", likeCount: 5 }),
      }, // parentRef
    );
    const res = await toggleLikeRecord({
      parentType: "post",
      parentId: "p1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual({ liked: false, count: 4 });
    expect(txDeleteMock).toHaveBeenCalledTimes(1);
    expect(txSetMock).not.toHaveBeenCalled();
    // Update payload uses the in-memory count, NOT FieldValue.increment
    // — that was the bug fixed in the like-count regression.
    const [, patch] = txUpdateMock.mock.calls[0] as [unknown, { likeCount: number }];
    expect(patch.likeCount).toBe(4);
  });

  it("turns ON when not previously liked (increment + write the like doc)", async () => {
    snapQueue.push(
      { exists: false }, // likeRef — not liked
      {
        exists: true,
        data: () => ({ status: "published", slug: "hello", likeCount: 5 }),
      },
    );
    const res = await toggleLikeRecord({
      parentType: "post",
      parentId: "p1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual({ liked: true, count: 6 });
    expect(txSetMock).toHaveBeenCalledTimes(1);
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("treats missing likeCount as 0 (legacy docs)", async () => {
    // The DB-vs-UI desync this guards: FieldValue.increment(-1) on a
    // doc with no likeCount drove it to -1 while the UI clamped at 0.
    // Reading prev → 0, computing in memory keeps DB and UI in sync.
    snapQueue.push(
      { exists: false },
      {
        exists: true,
        data: () => ({ status: "published", slug: "hello" }),
      },
    );
    const res = await toggleLikeRecord({
      parentType: "post",
      parentId: "p1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual({ liked: true, count: 1 });
  });

  it("clamps the decremented count at 0 (never goes negative)", async () => {
    // Two concurrent unlike races shouldn't drive the counter below 0.
    snapQueue.push(
      { exists: true }, // likeRef
      {
        exists: true,
        data: () => ({ status: "published", slug: "hello", likeCount: 0 }),
      },
    );
    const res = await toggleLikeRecord({
      parentType: "post",
      parentId: "p1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result.count).toBe(0);
  });
});

describe("toggleLikeRecord — visibility + parent existence", () => {
  it("returns an error when the parent doc is gone", async () => {
    snapQueue.push({ exists: false }, { exists: false });
    await expectError(
      toggleLikeRecord({ parentType: "post", parentId: "p1" }),
      "見つかりません",
    );
  });

  it("refuses likes on unpublished parents (defense in depth)", async () => {
    // Same gate as comments — otherwise drafts could accrue likes
    // that surface if/when an admin publishes the doc later.
    snapQueue.push(
      { exists: false },
      {
        exists: true,
        data: () => ({ status: "draft", slug: "p1" }),
      },
    );
    await expectError(
      toggleLikeRecord({ parentType: "post", parentId: "p1" }),
      "公開済み",
    );
  });

  it("refuses likes on projects with status='pending'", async () => {
    // Projects go through a moderation queue — 'pending' is NOT
    // publicly visible. Mirror the comment rule.
    snapQueue.push(
      { exists: false },
      {
        exists: true,
        data: () => ({ status: "pending", slug: "p1" }),
      },
    );
    await expectError(
      toggleLikeRecord({ parentType: "project", parentId: "p1" }),
      "公開済み",
    );
  });
});

describe("toggleLikeRecord — cache invalidation", () => {
  it("revalidates the canonical route prefix + parent slug", async () => {
    // /blog/{slug} for posts; /qa/{slug} for qa, etc. The prefix
    // comes from comments-parent.ts which has its own tests.
    snapQueue.push(
      { exists: false },
      {
        exists: true,
        data: () => ({ status: "published", slug: "hello-world" }),
      },
    );
    await toggleLikeRecord({ parentType: "post", parentId: "p1" });
    expect(revalidatePathMock).toHaveBeenCalledWith("/blog/hello-world");
  });
});

describe("toggleLikeComment", () => {
  it("rejects an empty commentId", async () => {
    await expectError(
      toggleLikeComment({
        parentType: "post",
        parentId: "p1",
        commentId: "",
      }),
      "入力エラー",
    );
  });

  it("returns an error when the comment doesn't exist (even if parent does)", async () => {
    // Order: likeRef, commentRef, parentRef.
    snapQueue.push(
      { exists: false },
      { exists: false }, // commentRef missing
      { exists: true, data: () => ({ status: "published", slug: "x" }) },
    );
    await expectError(
      toggleLikeComment({
        parentType: "post",
        parentId: "p1",
        commentId: "c1",
      }),
      "見つかりません",
    );
  });

  it("turns ON when not previously liked, using the comment's likeCount", async () => {
    snapQueue.push(
      { exists: false }, // likeRef
      { exists: true, data: () => ({ likeCount: 2 }) }, // commentRef
      { exists: true, data: () => ({ status: "published", slug: "x" }) },
    );
    const res = await toggleLikeComment({
      parentType: "post",
      parentId: "p1",
      commentId: "c1",
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.result).toEqual({ liked: true, count: 3 });
    // The increment patches the COMMENT doc (not the parent).
    const [, patch] = txUpdateMock.mock.calls[0] as [unknown, { likeCount: number }];
    expect(patch.likeCount).toBe(3);
  });

  it("refuses comment-likes when the PARENT is unpublished", async () => {
    // Even if a comment exists and the user can see it (as author),
    // an unpublished parent means new likes are blocked. Existing
    // likes stay in place — only NEW likes are refused.
    snapQueue.push(
      { exists: false },
      { exists: true, data: () => ({ likeCount: 0 }) },
      { exists: true, data: () => ({ status: "draft", slug: "x" }) },
    );
    await expectError(
      toggleLikeComment({
        parentType: "post",
        parentId: "p1",
        commentId: "c1",
      }),
      "公開済み",
    );
  });
});
