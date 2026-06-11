import { beforeEach, describe, expect, it, vi } from "vitest";

// Q&A has no moderation queue — questions go straight to "published" and
// admins can only flip published/archived after the fact. The tests pin
// the ownership gates, the client-supplied-id create path (images upload
// to qa/{id}/... before the doc exists), and the slug-stability rule on
// edit.

const requireUserMock = vi.fn();
const requireAdminMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`__REDIRECT__:${path}`);
});

const slugQueryGetMock = vi.fn();
const addMock = vi.fn();
const docGetMock = vi.fn();
const docUpdateMock = vi.fn();
const docDeleteMock = vi.fn();
const docCreateMock = vi.fn();

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
      doc: () => ({
        get: () => docGetMock(),
        update: (...args: unknown[]) => docUpdateMock(...args),
        delete: () => docDeleteMock(),
        create: (...args: unknown[]) => docCreateMock(...args),
      }),
    }),
  }),
}));

import {
  deleteMyQa,
  setQaStatus,
  submitQa,
  updateMyQa,
} from "@/app/actions/qa";

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
  title: "How do I file taxes?",
  body: "Question body",
};

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
  addMock.mockResolvedValue({ id: "new-qa-id" });
  docUpdateMock.mockResolvedValue(undefined);
  docDeleteMock.mockResolvedValue(undefined);
  docCreateMock.mockResolvedValue(undefined);
});

describe("submitQa — validation", () => {
  it("returns { ok: false } on a too-short title without writing", async () => {
    await expectError(submitQa({ ...validInput, title: "x" }), "入力エラー");
    expect(addMock).not.toHaveBeenCalled();
    expect(docCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied id with characters outside the auto-id shape", async () => {
    await expectError(
      submitQa({ ...validInput, id: "qa/../etc" }),
      "不正なID",
    );
    expect(docCreateMock).not.toHaveBeenCalled();
  });
});

describe("submitQa — create", () => {
  it("publishes immediately with the session author and redirects to the detail page", async () => {
    await expect(submitQa(validInput)).rejects.toThrow(
      "__REDIRECT__:/qa/how-do-i-file-taxes",
    );
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      slug: "how-do-i-file-taxes",
      status: "published",
      authorUid: "u1",
      authorName: "Alice",
      likeCount: 0,
    });
  });

  it("honors a pre-generated client id via create() instead of add()", async () => {
    // QaForm mints the id ahead of time so images land under
    // qa/{id}/... — the doc must be written at exactly that id.
    await expect(
      submitQa({ ...validInput, id: "AbCdEfGhIjKlMnOpQrSt" }),
    ).rejects.toThrow("__REDIRECT__");
    expect(docCreateMock).toHaveBeenCalledTimes(1);
    expect(addMock).not.toHaveBeenCalled();
  });

  it("maps an ALREADY_EXISTS create collision to a readable retry error", async () => {
    docCreateMock.mockRejectedValueOnce({ code: 6 });
    await expectError(
      submitQa({ ...validInput, id: "AbCdEfGhIjKlMnOpQrSt" }),
      "もう一度やり直してください",
    );
  });

  it("falls back to a suffixed slug when the base slug is taken", async () => {
    slugQueryGetMock
      .mockResolvedValueOnce({ empty: false, docs: [{ id: "other" }] })
      .mockResolvedValueOnce({ empty: true, docs: [] });
    await expect(submitQa(validInput)).rejects.toThrow("__REDIRECT__");
    const [payload] = addMock.mock.calls[0] as [{ slug: string }];
    // findFreeQaSlug's retrySuffix is `${slug}-${base36 ts}-${attempt}`, so a
    // collision yields a multi-segment suffix like `...-mq90k8wn-1` — the
    // hyphen before the attempt counter is expected. (The original regex
    // `-[a-z0-9]+$` predated that suffix shape and rejected it.)
    expect(payload.slug).toMatch(/^how-do-i-file-taxes(?:-[a-z0-9]+)+$/);
  });
});

describe("updateMyQa — ownership + slug stability", () => {
  it("returns qaNotFound for a missing doc", async () => {
    docGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(updateMyQa("q1", validInput), "見つかりません");
  });

  it("refuses a non-owner non-admin edit", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "someone-else", slug: "s" }),
    });
    await expectError(updateMyQa("q1", validInput), "編集する権限");
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("lets an admin edit someone else's question", async () => {
    requireUserMock.mockResolvedValueOnce({
      uid: "admin-1",
      displayName: "Admin",
      photoURL: null,
      email: "admin@x",
      isAdmin: true,
      isEditor: false,
      isContributor: false,
    });
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "someone-else", slug: "s" }),
    });
    await expect(updateMyQa("q1", validInput)).rejects.toThrow(
      "__REDIRECT__:/qa/s",
    );
    expect(docUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing slug when none is provided (inbound links stay alive)", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "stable-slug" }),
    });
    await expect(updateMyQa("q1", validInput)).rejects.toThrow(
      "__REDIRECT__:/qa/stable-slug",
    );
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.slug).toBe("stable-slug");
    // No slug change → no uniqueness probe.
    expect(slugQueryGetMock).not.toHaveBeenCalled();
  });
});

describe("deleteMyQa", () => {
  it("refuses a non-owner non-admin delete", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "someone-else", slug: "s" }),
    });
    await expectError(deleteMyQa("q1"), "削除する権限");
    expect(docDeleteMock).not.toHaveBeenCalled();
  });

  it("owner delete removes the doc and redirects to the list", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "s" }),
    });
    await expect(deleteMyQa("q1")).rejects.toThrow("__REDIRECT__:/qa");
    expect(docDeleteMock).toHaveBeenCalledTimes(1);
  });

  it("redirects without deleting when the doc is already gone", async () => {
    docGetMock.mockResolvedValueOnce({ exists: false });
    await expect(deleteMyQa("q1")).rejects.toThrow("__REDIRECT__:/qa");
    expect(docDeleteMock).not.toHaveBeenCalled();
  });
});

describe("setQaStatus — admin moderation", () => {
  it("is admin-gated (bubbles FORBIDDEN before any write)", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(
      setQaStatus({ qaId: "q1", status: "archived" }),
    ).rejects.toThrow("FORBIDDEN");
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown status value", async () => {
    await expectError(
      setQaStatus({ qaId: "q1", status: "hidden" as never }),
      "入力エラー",
    );
  });

  it("no-ops when the status already matches", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ slug: "s", status: "archived" }),
    });
    await expect(
      setQaStatus({ qaId: "q1", status: "archived" }),
    ).resolves.toEqual({ ok: true });
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("archives a published question", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ slug: "s", status: "published" }),
    });
    await expect(
      setQaStatus({ qaId: "q1", status: "archived" }),
    ).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("archived");
  });
});
