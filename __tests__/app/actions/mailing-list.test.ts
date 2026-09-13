import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminMock = vi.fn();
const setMock = vi.fn();
const deleteMock = vi.fn();
const docMock = vi.fn(() => ({ set: setMock, delete: deleteMock }));
const collectionMock = vi.fn(() => ({ doc: docMock }));
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({ collection: collectionMock }),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => ({ __fixed: "now" }) },
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/i18n/action-errors", () => ({
  inputError: () => Promise.resolve("入力エラー"),
}));

import {
  addMailingListSubscriber,
  removeMailingListSubscriber,
  subscribeToMailingList,
} from "@/app/actions/mailing-list";

beforeEach(() => {
  vi.resetAllMocks();
  requireAdminMock.mockResolvedValue({ uid: "admin", isAdmin: true });
  setMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
});

describe("subscribeToMailingList", () => {
  it("normalizes email and uses its hash as the id to prevent duplicates", async () => {
    await expect(
      subscribeToMailingList({
        email: "  PERSON@Example.COM ",
        locale: "ja",
        consent: true,
        website: "",
      }),
    ).resolves.toEqual({ ok: true });

    const normalized = "person@example.com";
    expect(docMock).toHaveBeenCalledWith(
      createHash("sha256").update(normalized).digest("hex"),
    );
    expect(setMock).toHaveBeenCalledWith(
      {
        email: normalized,
        locale: "ja",
        source: "public",
        consentVersion: 1,
        subscribedAt: { __fixed: "now" },
        updatedAt: { __fixed: "now" },
      },
      { merge: true },
    );
  });

  it("requires explicit consent", async () => {
    await expect(
      subscribeToMailingList({
        email: "person@example.com",
        locale: "ja",
        consent: false,
        website: "",
      }),
    ).resolves.toEqual({ ok: false, error: "入力エラー" });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("silently drops honeypot submissions", async () => {
    await expect(
      subscribeToMailingList({
        email: "bot@example.com",
        locale: "en",
        consent: true,
        website: "filled-by-bot",
      }),
    ).resolves.toEqual({ ok: true });
    expect(setMock).not.toHaveBeenCalled();
  });
});

describe("mailing list admin actions", () => {
  it("requires admin before adding a subscriber", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(
      addMailingListSubscriber({ email: "person@example.com", locale: "ja" }),
    ).rejects.toThrow("FORBIDDEN");
    expect(setMock).not.toHaveBeenCalled();
  });

  it("marks manually added subscribers as admin-sourced", async () => {
    await expect(
      addMailingListSubscriber({ email: "person@example.com", locale: "en" }),
    ).resolves.toEqual({ ok: true });
    expect(setMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "person@example.com",
        locale: "en",
        source: "admin",
      }),
      { merge: true },
    );
  });

  it("validates ids before deleting", async () => {
    await expect(
      removeMailingListSubscriber({ subscriberId: "../users/admin" }),
    ).resolves.toEqual({ ok: false, error: "入力エラー" });
    expect(deleteMock).not.toHaveBeenCalled();

    const id = "a".repeat(64);
    await expect(
      removeMailingListSubscriber({ subscriberId: id }),
    ).resolves.toEqual({ ok: true });
    expect(docMock).toHaveBeenLastCalledWith(id);
    expect(deleteMock).toHaveBeenCalledOnce();
  });
});
