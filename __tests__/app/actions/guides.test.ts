import { beforeEach, describe, expect, it, vi } from "vitest";

// Guide actions carry the richest role ladder in the app: plain users
// are clamped into the review queue, contributors may self-publish their
// own guides, and admin/editor (curators) may edit anything, re-order
// the public list, and approve submissions. These tests pin the
// resolveStatus downgrade, the order clamp, the draft-id create path,
// and the approve-from-edit-form side effects (reviewer stamp +
// contributor auto-promotion + decision mail).

const requireUserMock = vi.fn();
const requireAdminMock = vi.fn();
const requireEditorMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`__REDIRECT__:${path}`);
});

const slugQueryGetMock = vi.fn();
const addMock = vi.fn();
const guideGetMock = vi.fn();
const guideUpdateMock = vi.fn();
const guideDeleteMock = vi.fn();
const guideCreateMock = vi.fn();
const userGetMock = vi.fn();
const userUpdateMock = vi.fn();
const getUserMock = vi.fn();
const setCustomUserClaimsMock = vi.fn();
const deleteFilesMock = vi.fn();
const adminNewGuideMock = vi.fn();
const decisionMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
  requireAdmin: () => requireAdminMock(),
  requireEditor: () => requireEditorMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/i18n/redirects", () => ({
  redirectToLocalizedPath: (path: string) => redirectMock(path),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "__server_ts__",
    delete: () => "__field_delete__",
  },
  Timestamp: { now: () => ({ __fixed: "now" }) },
}));

vi.mock("@/lib/notifications", () => ({
  enqueueAdminNewGuideNotification: (...args: unknown[]) =>
    adminNewGuideMock(...args),
  enqueueGuideDecisionNotification: (...args: unknown[]) =>
    decisionMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => {
  function guidesCollection() {
    return {
      where: () => ({ limit: () => ({ get: () => slugQueryGetMock() }) }),
      add: (...args: unknown[]) => addMock(...args),
      doc: () => ({
        get: () => guideGetMock(),
        update: (...args: unknown[]) => guideUpdateMock(...args),
        delete: () => guideDeleteMock(),
        create: (...args: unknown[]) => guideCreateMock(...args),
      }),
    };
  }
  function usersCollection() {
    return {
      doc: () => ({
        get: () => userGetMock(),
        update: (...args: unknown[]) => userUpdateMock(...args),
      }),
    };
  }
  return {
    adminDb: () => ({
      collection: (name: string) =>
        name === "guides" ? guidesCollection() : usersCollection(),
    }),
    adminAuth: () => ({
      getUser: (...args: unknown[]) => getUserMock(...args),
      setCustomUserClaims: (...args: unknown[]) =>
        setCustomUserClaimsMock(...args),
    }),
    adminStorage: () => ({
      bucket: () => ({
        deleteFiles: (...args: unknown[]) => deleteFilesMock(...args),
      }),
    }),
  };
});

import {
  archiveGuide,
  decideGuide,
  deleteGuide,
  submitGuide,
  updateGuide,
} from "@/app/actions/guides";

async function expectError(
  p: Promise<{ ok: true } | { ok: false; error: string }>,
  fragment: string,
) {
  const res = await p;
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("expected an { ok: false } result");
  expect(res.error).toContain(fragment);
}

function sessionUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: "u1",
    displayName: "Alice",
    photoURL: null,
    email: "alice@x",
    isAdmin: false,
    isEditor: false,
    isContributor: false,
    ...overrides,
  };
}

const validInput = {
  title: "My Guide",
  body: "Some useful knowledge",
  status: "pending" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  requireUserMock.mockResolvedValue(sessionUser());
  requireEditorMock.mockResolvedValue(
    sessionUser({ uid: "editor-1", displayName: "Ed", isEditor: true }),
  );
  requireAdminMock.mockResolvedValue(
    sessionUser({ uid: "admin-1", displayName: "Admin", isAdmin: true }),
  );
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`__REDIRECT__:${path}`);
  });
  slugQueryGetMock.mockResolvedValue({ empty: true, docs: [] });
  addMock.mockResolvedValue({ id: "new-guide-id" });
  guideUpdateMock.mockResolvedValue(undefined);
  guideDeleteMock.mockResolvedValue(undefined);
  guideCreateMock.mockResolvedValue(undefined);
  userGetMock.mockResolvedValue({ exists: false });
  userUpdateMock.mockResolvedValue(undefined);
  getUserMock.mockResolvedValue({ customClaims: {} });
  setCustomUserClaimsMock.mockResolvedValue(undefined);
  deleteFilesMock.mockResolvedValue(undefined);
  adminNewGuideMock.mockResolvedValue(undefined);
  decisionMock.mockResolvedValue(undefined);
});

describe("submitGuide — validation + status resolution", () => {
  it("returns { ok: false } on invalid input without writing", async () => {
    await expectError(submitGuide({ ...validInput, title: "x" }), "入力エラー");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("downgrades a plain user's 'published' request to 'pending' (review-queue bypass guard)", async () => {
    await expect(
      submitGuide({ ...validInput, status: "published" }),
    ).rejects.toThrow("__REDIRECT__:/my/guides");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.status).toBe("pending");
    expect(payload.submittedAt).toEqual({ __fixed: "now" });
    expect(payload).not.toHaveProperty("publishedAt");
    // Pending submissions ping the admins for review.
    expect(adminNewGuideMock).toHaveBeenCalledWith(
      expect.objectContaining({ guideId: "new-guide-id" }),
    );
  });

  it("lets a contributor self-publish (publishedAt stamped, no admin mail)", async () => {
    requireUserMock.mockResolvedValueOnce(
      sessionUser({ isContributor: true }),
    );
    await expect(
      submitGuide({ ...validInput, status: "published" }),
    ).rejects.toThrow("__REDIRECT__:/my/guides");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.status).toBe("published");
    expect(payload.publishedAt).toEqual({ __fixed: "now" });
    expect(adminNewGuideMock).not.toHaveBeenCalled();
  });

  it("clamps a non-curator's order to the default (no pin-to-top via crafted payload)", async () => {
    requireUserMock.mockResolvedValueOnce(
      sessionUser({ isContributor: true }),
    );
    await expect(
      submitGuide({ ...validInput, status: "draft", order: 0 }),
    ).rejects.toThrow("__REDIRECT__");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.order).toBe(100);
  });

  it("honors a curator's order and routes them to the admin edit page", async () => {
    requireUserMock.mockResolvedValueOnce(
      sessionUser({ uid: "editor-1", isEditor: true }),
    );
    await expect(
      submitGuide({ ...validInput, status: "published", order: 0 }),
    ).rejects.toThrow("__REDIRECT__:/admin/guides/new-guide-id/edit");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.order).toBe(0);
  });

  it("rejects an explicitly-requested slug that is already taken", async () => {
    slugQueryGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "other" }],
    });
    await expectError(
      submitGuide({ ...validInput, slug: "taken-slug" }),
      "スラッグ",
    );
    expect(addMock).not.toHaveBeenCalled();
  });
});

describe("submitGuide — pre-supplied draft id", () => {
  it("rejects a draftId that doesn't match the Firestore auto-id shape", async () => {
    await expectError(
      submitGuide(validInput, "../sneaky/path"),
      "不正な下書きID",
    );
    expect(guideCreateMock).not.toHaveBeenCalled();
  });

  it("creates at the supplied id and maps ALREADY_EXISTS to a readable error", async () => {
    const draftId = "A".repeat(20);
    guideCreateMock.mockRejectedValueOnce({ code: 6 });
    await expectError(submitGuide(validInput, draftId), "既に使われています");
    expect(addMock).not.toHaveBeenCalled();
  });
});

describe("updateGuide — authorization + status clamp", () => {
  it("refuses a plain user editing someone else's guide", async () => {
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "someone-else", slug: "g", status: "draft" }),
    });
    await expectError(updateGuide("g1", validInput), "編集する権限");
    expect(guideUpdateMock).not.toHaveBeenCalled();
  });

  it("clamps a plain owner's 'published' request back to 'pending'", async () => {
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "g", status: "draft" }),
    });
    await expect(
      updateGuide("g1", { ...validInput, status: "published" }),
    ).resolves.toEqual({ ok: true });
    const [patch] = guideUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("pending");
    expect(patch.submittedAt).toEqual({ __fixed: "now" });
    expect(patch).not.toHaveProperty("publishedAt");
  });

  it("keeps the order field stable for non-curators", async () => {
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "g", status: "draft", order: 42 }),
    });
    await expect(
      updateGuide("g1", { ...validInput, status: "draft", order: 0 }),
    ).resolves.toEqual({ ok: true });
    const [patch] = guideUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.order).toBe(42);
  });

  it("rejects a slug change that collides with another guide", async () => {
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "old-slug", status: "draft" }),
    });
    slugQueryGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "a-different-guide" }],
    });
    await expectError(
      updateGuide("g1", { ...validInput, slug: "wanted-slug" }),
      "スラッグ",
    );
    expect(guideUpdateMock).not.toHaveBeenCalled();
  });

  it("editor approving a pending submission runs the full decide side effects", async () => {
    // Approving from the edit form must not silently bypass what
    // decideGuide would do: reviewer stamp, stale-note wipe, first
    // publishedAt, contributor auto-promotion, and the decision mail.
    requireUserMock.mockResolvedValueOnce(
      sessionUser({ uid: "editor-1", displayName: "Ed", isEditor: true }),
    );
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        authorUid: "author-9",
        slug: "g",
        status: "pending",
        title: "T",
      }),
    });
    userGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ email: "author@x" }),
    });
    await expect(
      updateGuide("g1", { ...validInput, status: "published" }),
    ).resolves.toEqual({ ok: true });
    const [patch] = guideUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch).toMatchObject({
      status: "published",
      reviewerUid: "editor-1",
      reviewNote: "",
      publishedAt: { __fixed: "now" },
    });
    // First approval promotes the author to contributor…
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith("author-9", {
      contributor: true,
    });
    // …and the decision mail carries the promotion flag.
    expect(decisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "author@x",
        decision: "published",
        promoted: true,
      }),
    );
  });
});

describe("deleteGuide", () => {
  it("treats a missing guide as success (idempotent)", async () => {
    guideGetMock.mockResolvedValueOnce({ exists: false });
    await expect(deleteGuide("g1")).resolves.toEqual({ ok: true });
    expect(guideDeleteMock).not.toHaveBeenCalled();
  });

  it("refuses a plain non-owner delete", async () => {
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "someone-else", slug: "g", status: "draft" }),
    });
    await expectError(deleteGuide("g1"), "削除する権限");
    expect(guideDeleteMock).not.toHaveBeenCalled();
  });

  it("owner delete removes the doc and prefix-sweeps the uploaded images", async () => {
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "g", status: "published" }),
    });
    await expect(deleteGuide("g1")).resolves.toEqual({ ok: true });
    expect(guideDeleteMock).toHaveBeenCalledTimes(1);
    expect(deleteFilesMock).toHaveBeenCalledWith({ prefix: "guides/g1/" });
  });
});

describe("decideGuide / archiveGuide — review queue", () => {
  it("is editor-gated (bubbles FORBIDDEN before any write)", async () => {
    requireEditorMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(decideGuide("g1", "published")).rejects.toThrow("FORBIDDEN");
    expect(guideUpdateMock).not.toHaveBeenCalled();
  });

  it("rejection stores the note, mails the author, and skips promotion", async () => {
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "author-9", slug: "g", title: "T" }),
    });
    userGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ email: "author@x" }),
    });
    await expect(
      decideGuide("g1", "rejected", "needs sources"),
    ).resolves.toEqual({ ok: true });
    const [patch] = guideUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("rejected");
    expect(patch.reviewNote).toBe("needs sources");
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
    expect(decisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "rejected", note: "needs sources" }),
    );
  });

  it("does not re-promote an already-trusted author on approval", async () => {
    guideGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "author-9", slug: "g", title: "T" }),
    });
    getUserMock.mockResolvedValueOnce({
      customClaims: { contributor: true },
    });
    userGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ email: "author@x" }),
    });
    await expect(decideGuide("g1", "published")).resolves.toEqual({
      ok: true,
    });
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
    expect(decisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "published", promoted: false }),
    );
  });

  it("archiveGuide is admin-only (editor is not enough)", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(archiveGuide("g1")).rejects.toThrow("FORBIDDEN");
    expect(guideUpdateMock).not.toHaveBeenCalled();
  });
});
