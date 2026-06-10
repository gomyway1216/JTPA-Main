import { beforeEach, describe, expect, it, vi } from "vitest";

// submitFeedback takes the submitter identity from the SESSION (never the
// payload) and setFeedbackStatus implements the editor-triage /
// admin-only-archive split (PR #88). These tests pin both, plus the
// reviewer attribution rules on each transition.

const requireUserMock = vi.fn();
const requireEditorMock = vi.fn();
const revalidatePathMock = vi.fn();
const addMock = vi.fn();
const docUpdateMock = vi.fn();
const getMyProfileMock = vi.fn();
const enqueueMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
  requireEditor: () => requireEditorMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => ({ __fixed: "now" }) },
}));

vi.mock("@/lib/data/users", () => ({
  getMyProfile: (...args: unknown[]) => getMyProfileMock(...args),
}));

vi.mock("@/lib/notifications", () => ({
  enqueueAdminNewFeedbackNotification: (...args: unknown[]) =>
    enqueueMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: () => ({
      add: (...args: unknown[]) => addMock(...args),
      doc: () => ({
        update: (...args: unknown[]) => docUpdateMock(...args),
      }),
    }),
  }),
}));

import { setFeedbackStatus, submitFeedback } from "@/app/actions/feedback";

async function expectError(
  p: Promise<{ ok: true } | { ok: false; error: string }>,
  fragment: string,
) {
  const res = await p;
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("expected an { ok: false } result");
  expect(res.error).toContain(fragment);
}

beforeEach(() => {
  vi.resetAllMocks();
  requireUserMock.mockResolvedValue({
    uid: "u1",
    displayName: "Alice",
    photoURL: null,
    email: "alice@x",
    isAdmin: false,
    isEditor: false,
    isContributor: false,
  });
  requireEditorMock.mockResolvedValue({
    uid: "editor-1",
    displayName: "Ed",
    photoURL: null,
    email: "ed@x",
    isAdmin: false,
    isEditor: true,
    isContributor: false,
  });
  addMock.mockResolvedValue({ id: "fb-1" });
  docUpdateMock.mockResolvedValue(undefined);
  getMyProfileMock.mockResolvedValue(null);
  enqueueMock.mockResolvedValue(undefined);
});

describe("submitFeedback — validation", () => {
  it("rejects a body under 4 chars without writing", async () => {
    await expectError(submitFeedback({ body: "abc" }), "入力エラー");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects a body over 2000 chars", async () => {
    await expectError(
      submitFeedback({ body: "x".repeat(2001) }),
      "入力エラー",
    );
  });
});

describe("submitFeedback — identity comes from the session", () => {
  it("stores the session uid/email, status 'new', and empty reviewer fields", async () => {
    const res = await submitFeedback({ body: "The QR page is broken" });
    expect(res).toEqual({ ok: true, id: "fb-1" });
    const [doc] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(doc).toMatchObject({
      body: "The QR page is broken",
      authorUid: "u1",
      authorEmail: "alice@x",
      status: "new",
      reviewerUid: null,
      reviewerDisplayName: null,
      reviewedAt: null,
    });
  });

  it("prefers the profile doc's displayName/username over the cached session", async () => {
    // A recent /my/profile rename should show up immediately in the
    // admin triage list.
    getMyProfileMock.mockResolvedValueOnce({
      displayName: "Alice Renamed",
      username: "alice_r",
    });
    await submitFeedback({ body: "feedback body" });
    const [doc] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(doc.authorDisplayName).toBe("Alice Renamed");
    expect(doc.authorUsername).toBe("alice_r");
  });

  it("falls back to session fields when the profile read fails", async () => {
    getMyProfileMock.mockRejectedValueOnce(new Error("firestore down"));
    const res = await submitFeedback({ body: "feedback body" });
    expect(res).toEqual({ ok: true, id: "fb-1" });
    const [doc] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(doc.authorDisplayName).toBe("Alice");
    expect(doc.authorUsername).toBeNull();
  });

  it("still succeeds when the admin notification enqueue fails (fire-and-forget)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    enqueueMock.mockRejectedValueOnce(new Error("mail queue down"));
    const res = await submitFeedback({ body: "feedback body" });
    expect(res).toEqual({ ok: true, id: "fb-1" });
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());
    warnSpy.mockRestore();
  });
});

describe("setFeedbackStatus — role gates", () => {
  it("requires editor (bubbles FORBIDDEN before any write)", async () => {
    requireEditorMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(
      setFeedbackStatus({ feedbackId: "f1", status: "read" }),
    ).rejects.toThrow("FORBIDDEN");
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown status value", async () => {
    await expectError(
      setFeedbackStatus({ feedbackId: "f1", status: "spam" as never }),
      "入力エラー",
    );
  });

  it("blocks editors from archiving (admin-only terminal state)", async () => {
    await expectError(
      setFeedbackStatus({ feedbackId: "f1", status: "archived" }),
      "admin",
    );
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("lets an admin archive", async () => {
    requireEditorMock.mockResolvedValueOnce({
      uid: "admin-1",
      displayName: "Admin",
      photoURL: null,
      email: "admin@x",
      isAdmin: true,
      isEditor: false,
      isContributor: false,
    });
    await expect(
      setFeedbackStatus({ feedbackId: "f1", status: "archived" }),
    ).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("archived");
    expect(patch.reviewerUid).toBe("admin-1");
  });
});

describe("setFeedbackStatus — reviewer attribution", () => {
  it("stamps the acting editor + timestamp on a triage transition", async () => {
    await expect(
      setFeedbackStatus({ feedbackId: "f1", status: "read" }),
    ).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch).toEqual({
      status: "read",
      reviewerUid: "editor-1",
      reviewerDisplayName: "Ed",
      reviewedAt: { __fixed: "now" },
    });
  });

  it("wipes the reviewer fields when un-triaging back to 'new'", async () => {
    // A stale "marked read by …" attribution on a re-opened entry would
    // mislead the triage list.
    await expect(
      setFeedbackStatus({ feedbackId: "f1", status: "new" }),
    ).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch).toEqual({
      status: "new",
      reviewerUid: null,
      reviewerDisplayName: null,
      reviewedAt: null,
    });
  });

  it("stores null (not '') for a blank actor displayName", async () => {
    requireEditorMock.mockResolvedValueOnce({
      uid: "editor-1",
      displayName: "",
      photoURL: null,
      email: "ed@x",
      isAdmin: false,
      isEditor: true,
      isContributor: false,
    });
    await setFeedbackStatus({ feedbackId: "f1", status: "resolved" });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.reviewerDisplayName).toBeNull();
  });
});
