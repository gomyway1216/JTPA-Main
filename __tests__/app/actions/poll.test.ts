import { beforeEach, describe, expect, it, vi } from "vitest";

// Poll actions guard two invariants worth pinning:
//   - option ids are server-minted (a crafted payload can't seed
//     duplicate ids that would double-count a single ballot), and the
//     option list freezes once anyone has voted;
//   - castPollVote runs per-option deltas + the voterCount inside one
//     transaction so the denormalized counts never drift from ballots.
// Mock runTransaction to run the callback against a hand-rolled tx whose
// .get() returns scripted snapshots keyed by the ref tag (same dispatch
// style as users.test.ts).

const requireUserMock = vi.fn();
const requireAdminMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`__REDIRECT__:${path}`);
});

const slugQueryGetMock = vi.fn();
const addMock = vi.fn();
const pollGetMock = vi.fn();
const pollUpdateMock = vi.fn();
const pollDeleteMock = vi.fn();

const txGetMock = vi.fn();
const txSetMock = vi.fn();
const txUpdateMock = vi.fn();
const txDeleteMock = vi.fn();

// tx.get() dispatches on the ref tag, not call order: the poll ref carries
// __pollId, the per-user vote ref carries __voteFor. castPollVote reads both
// concurrently via Promise.all, so a shift-queue would couple the tests to
// argument order; keying by ref keeps them order-independent (same pattern
// as users.test.ts). Tests script these two snapshots per case.
type TxSnap = { exists: boolean; data?: () => unknown };
let pollTxSnap: TxSnap = { exists: false };
let voteTxSnap: TxSnap = { exists: false };

// Named impl so beforeEach can re-install it after vi.resetAllMocks().
const runTransactionImpl = async (cb: (tx: unknown) => Promise<unknown>) => {
  txGetMock.mockImplementation(
    async (ref: { __pollId?: string; __voteFor?: string }) => {
      if (ref?.__pollId !== undefined) return pollTxSnap;
      if (ref?.__voteFor !== undefined) return voteTxSnap;
      throw new Error("test bug: unknown ref passed to tx.get");
    },
  );
  return await cb({
    get: txGetMock,
    set: txSetMock,
    update: txUpdateMock,
    delete: txDeleteMock,
  });
};
const runTransactionMock = vi.fn(runTransactionImpl);

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/i18n/redirects", () => ({
  redirectToLocalizedPath: (path: string) => redirectMock(path),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => ({ __fixed: "now" }) },
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: () => ({
      where: () => ({ limit: () => ({ get: () => slugQueryGetMock() }) }),
      add: (...args: unknown[]) => addMock(...args),
      doc: (id: string) => ({
        __pollId: id,
        get: () => pollGetMock(),
        update: (...args: unknown[]) => pollUpdateMock(...args),
        delete: () => pollDeleteMock(),
        collection: () => ({
          doc: (uid: string) => ({ __voteFor: uid }),
        }),
      }),
    }),
    runTransaction: (cb: (tx: unknown) => Promise<unknown>) =>
      runTransactionMock(cb),
  }),
}));

import {
  castPollVote,
  deleteMyPoll,
  setPollStatus,
  submitPoll,
  updateMyPoll,
} from "@/app/actions/poll";

async function expectError(
  p: Promise<{ ok: true } | { ok: false; error: string }>,
  fragment: string,
) {
  const res = await p;
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("expected an { ok: false } result");
  expect(res.error).toContain(fragment);
}

const validInput = {
  title: "Favorite stack?",
  options: [{ label: "Next.js" }, { label: "Rails" }],
};

beforeEach(() => {
  vi.resetAllMocks();
  runTransactionMock.mockImplementation(runTransactionImpl);
  requireUserMock.mockResolvedValue({
    uid: "u1",
    displayName: "Alice",
    photoURL: null,
    email: "alice@x",
    isAdmin: false,
    isEditor: false,
    isContributor: false,
  });
  requireAdminMock.mockResolvedValue({
    uid: "admin-1",
    displayName: "Admin",
    photoURL: null,
    email: "admin@x",
    isAdmin: true,
    isEditor: false,
    isContributor: false,
  });
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`__REDIRECT__:${path}`);
  });
  slugQueryGetMock.mockResolvedValue({ empty: true, docs: [] });
  addMock.mockResolvedValue({ id: "new-poll-id" });
  pollUpdateMock.mockResolvedValue(undefined);
  pollDeleteMock.mockResolvedValue(undefined);
  pollTxSnap = { exists: false };
  voteTxSnap = { exists: false };
});

describe("submitPoll — validation + option hygiene", () => {
  it("rejects fewer than 2 options", async () => {
    await expectError(
      submitPoll({ title: "T?", options: [{ label: "Only" }] }),
      "選択肢は2つ以上",
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects when label dedupe leaves fewer than 2 options", async () => {
    // "Claude" and "claude " collapse to one option after trim+lowercase.
    await expectError(
      submitPoll({
        title: "T?",
        options: [{ label: "Claude" }, { label: "claude " }],
      }),
      "重複を除いた選択肢",
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("mints fresh server-side option ids, ignoring client-supplied ones", async () => {
    // Trusting caller ids would let a crafted payload seed two options
    // with the SAME id — castPollVote keys deltas by id, so one ballot
    // would update both rows.
    await expect(
      submitPoll({
        title: "T?",
        options: [
          { id: "evil", label: "A" },
          { id: "evil", label: "B" },
        ],
      }),
    ).rejects.toThrow("__REDIRECT__");
    const [payload] = addMock.mock.calls[0] as [
      { options: Array<{ id: string; label: string; voteCount: number }> },
    ];
    expect(payload.options).toHaveLength(2);
    expect(payload.options[0].id).not.toBe("evil");
    expect(payload.options[1].id).not.toBe("evil");
    expect(payload.options[0].id).not.toBe(payload.options[1].id);
    expect(payload.options.every((o) => o.voteCount === 0)).toBe(true);
  });

  it("publishes immediately with zeroed counters and redirects to the detail", async () => {
    await expect(submitPoll(validInput)).rejects.toThrow(
      "__REDIRECT__:/poll/favorite-stack",
    );
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      slug: "favorite-stack",
      status: "published",
      authorUid: "u1",
      voterCount: 0,
      likeCount: 0,
    });
  });

  it("stores localized poll content with shared option ids", async () => {
    const ja = {
      title: "好きなスタックは？",
      description: "複数選択できます",
      options: [{ label: "Next.js" }, { label: "Rails" }],
    };
    const en = {
      title: "Favorite stack?",
      description: "Choose all that apply",
      options: [{ label: "Next.js" }, { label: "Ruby on Rails" }],
    };
    await expect(submitPoll({ localized: { ja, en } })).rejects.toThrow(
      "__REDIRECT__:/poll",
    );
    const [payload] = addMock.mock.calls[0] as [
      {
        title: string;
        description: string;
        locales: string[];
        options: Array<{ id: string; label: string; voteCount: number }>;
        localized: Record<
          string,
          { options: Array<{ id: string; label: string }> }
        >;
      },
    ];
    expect(payload.title).toBe(ja.title);
    expect(payload.description).toBe(ja.description);
    expect(payload.locales).toEqual(["ja", "en"]);
    expect(payload.localized.ja.options.map((option) => option.id)).toEqual(
      payload.options.map((option) => option.id),
    );
    expect(payload.localized.en.options).toEqual([
      { id: payload.options[0].id, label: "Next.js" },
      { id: payload.options[1].id, label: "Ruby on Rails" },
    ]);
  });
});

describe("updateMyPoll — ownership + option freeze", () => {
  it("returns pollNotFound for a missing doc", async () => {
    pollGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(updateMyPoll("p1", validInput), "見つかりません");
  });

  it("refuses a non-owner non-admin edit before the transaction", async () => {
    pollGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "someone-else", slug: "s", voterCount: 0 }),
    });
    await expectError(updateMyPoll("p1", validInput), "編集する権限");
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("freezes the option list once anyone has voted (title still editable)", async () => {
    const frozenOptions = [
      { id: "aaaa1111", label: "Old A", voteCount: 2 },
      { id: "bbbb2222", label: "Old B", voteCount: 1 },
    ];
    const doc = {
      exists: true,
      data: () => ({
        authorUid: "u1",
        slug: "s",
        voterCount: 3,
        options: frozenOptions,
      }),
    };
    pollGetMock.mockResolvedValueOnce(doc);
    pollTxSnap = doc;
    await expect(
      updateMyPoll("p1", {
        title: "New title?",
        options: [{ label: "Hijack 1" }, { label: "Hijack 2" }],
      }),
    ).rejects.toThrow("__REDIRECT__:/poll/s");
    const [, patch] = txUpdateMock.mock.calls[0] as [
      unknown,
      { title: string; options: unknown },
    ];
    expect(patch.title).toBe("New title?");
    // Options unchanged — rewriting them would orphan existing ballots.
    expect(patch.options).toEqual(frozenOptions);
  });

  it("rewrites options while there are zero voters, preserving surviving ids", async () => {
    const doc = {
      exists: true,
      data: () => ({
        authorUid: "u1",
        slug: "s",
        voterCount: 0,
        options: [{ id: "keep1234", label: "Old", voteCount: 0 }],
      }),
    };
    pollGetMock.mockResolvedValueOnce(doc);
    pollTxSnap = doc;
    await expect(
      updateMyPoll("p1", {
        title: "T?",
        options: [{ id: "keep1234", label: "Old" }, { label: "New" }],
      }),
    ).rejects.toThrow("__REDIRECT__");
    const [, patch] = txUpdateMock.mock.calls[0] as [
      unknown,
      { options: Array<{ id: string; label: string; voteCount: number }> },
    ];
    expect(patch.options).toHaveLength(2);
    expect(patch.options[0].id).toBe("keep1234");
    expect(patch.options[1].id).not.toBe("keep1234");
    expect(patch.options.every((o) => o.voteCount === 0)).toBe(true);
  });
});

describe("deleteMyPoll / setPollStatus", () => {
  it("refuses a non-owner non-admin delete", async () => {
    pollGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "someone-else", slug: "s" }),
    });
    await expectError(deleteMyPoll("p1"), "削除する権限");
    expect(pollDeleteMock).not.toHaveBeenCalled();
  });

  it("owner delete removes the doc and redirects to the list", async () => {
    pollGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "s" }),
    });
    await expect(deleteMyPoll("p1")).rejects.toThrow("__REDIRECT__:/poll");
    expect(pollDeleteMock).toHaveBeenCalledTimes(1);
  });

  it("setPollStatus is admin-gated and no-ops on an unchanged status", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(
      setPollStatus({ pollId: "p1", status: "archived" }),
    ).rejects.toThrow("FORBIDDEN");

    pollGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ slug: "s", status: "archived" }),
    });
    await expect(
      setPollStatus({ pollId: "p1", status: "archived" }),
    ).resolves.toEqual({ ok: true });
    expect(pollUpdateMock).not.toHaveBeenCalled();
  });
});

describe("castPollVote — guards", () => {
  it("returns pollNotFound when the poll is gone", async () => {
    pollTxSnap = { exists: false };
    voteTxSnap = { exists: false };
    await expectError(
      castPollVote({ pollId: "p1", optionIds: ["a"] }),
      "見つかりません",
    );
  });

  it("refuses votes on a closed (archived) poll", async () => {
    pollTxSnap = {
      exists: true,
      data: () => ({
        slug: "s",
        status: "archived",
        voterCount: 1,
        options: [{ id: "a", label: "A", voteCount: 1 }],
      }),
    };
    voteTxSnap = { exists: false };
    await expectError(
      castPollVote({ pollId: "p1", optionIds: ["a"] }),
      "公開中",
    );
    expect(txSetMock).not.toHaveBeenCalled();
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects phantom option ids that aren't on the poll", async () => {
    pollTxSnap = {
      exists: true,
      data: () => ({
        slug: "s",
        status: "published",
        voterCount: 0,
        options: [{ id: "a", label: "A", voteCount: 0 }],
      }),
    };
    voteTxSnap = { exists: false };
    await expectError(
      castPollVote({ pollId: "p1", optionIds: ["zzz"] }),
      "不正な選択肢",
    );
    expect(txUpdateMock).not.toHaveBeenCalled();
  });
});

describe("castPollVote — ballot lifecycle", () => {
  const pollDoc = (voterCount: number, counts: [number, number]) => ({
    exists: true,
    data: () => ({
      slug: "s",
      status: "published",
      voterCount,
      options: [
        { id: "a", label: "A", voteCount: counts[0] },
        { id: "b", label: "B", voteCount: counts[1] },
      ],
    }),
  });

  it("first ballot: writes the vote doc, +1 on the option and the voterCount", async () => {
    pollTxSnap = pollDoc(0, [0, 0]);
    voteTxSnap = { exists: false };
    const res = await castPollVote({ pollId: "p1", optionIds: ["a"] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.voterCount).toBe(1);
      expect(res.result.options).toEqual([
        { id: "a", label: "A", voteCount: 1 },
        { id: "b", label: "B", voteCount: 0 },
      ]);
    }
    const [voteRef, ballot] = txSetMock.mock.calls[0] as [
      { __voteFor: string },
      { optionIds: string[] },
    ];
    expect(voteRef.__voteFor).toBe("u1");
    expect(ballot.optionIds).toEqual(["a"]);
  });

  it("dedupes repeated ids in a multi-select payload (single +1)", async () => {
    pollTxSnap = pollDoc(0, [0, 0]);
    voteTxSnap = { exists: false };
    const res = await castPollVote({
      pollId: "p1",
      optionIds: ["a", "a", "b"],
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.optionIds).toEqual(["a", "b"]);
      expect(res.result.options.map((o) => o.voteCount)).toEqual([1, 1]);
      expect(res.result.voterCount).toBe(1);
    }
  });

  it("changing a ballot moves the count without touching voterCount", async () => {
    pollTxSnap = pollDoc(5, [3, 1]);
    voteTxSnap = {
      exists: true,
      data: () => ({ optionIds: ["a"], createdAt: { __fixed: "earlier" } }),
    };
    const res = await castPollVote({ pollId: "p1", optionIds: ["b"] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.voterCount).toBe(5);
      expect(res.result.options.map((o) => o.voteCount)).toEqual([2, 2]);
    }
    // The re-written ballot keeps its original createdAt.
    const [, ballot] = txSetMock.mock.calls[0] as [
      unknown,
      { createdAt: unknown },
    ];
    expect(ballot.createdAt).toEqual({ __fixed: "earlier" });
  });

  it("an empty selection un-votes: ballot deleted, counts decremented", async () => {
    pollTxSnap = pollDoc(1, [1, 0]);
    voteTxSnap = {
      exists: true,
      data: () => ({ optionIds: ["a"], createdAt: { __fixed: "earlier" } }),
    };
    const res = await castPollVote({ pollId: "p1", optionIds: [] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.optionIds).toEqual([]);
      expect(res.result.voterCount).toBe(0);
      expect(res.result.options.map((o) => o.voteCount)).toEqual([0, 0]);
    }
    expect(txDeleteMock).toHaveBeenCalledTimes(1);
    expect(txSetMock).not.toHaveBeenCalled();
  });

  it("clamps counts at zero when a legacy doc would go negative", async () => {
    // Ballot says "a" but the option count is already 0 — the decrement
    // must not drive the counter (or voterCount) below zero.
    pollTxSnap = pollDoc(0, [0, 0]);
    voteTxSnap = {
      exists: true,
      data: () => ({ optionIds: ["a"], createdAt: { __fixed: "earlier" } }),
    };
    const res = await castPollVote({ pollId: "p1", optionIds: [] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.voterCount).toBe(0);
      expect(res.result.options.map((o) => o.voteCount)).toEqual([0, 0]);
    }
  });
});
