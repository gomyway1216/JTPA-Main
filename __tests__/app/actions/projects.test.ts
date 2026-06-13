import { beforeEach, describe, expect, it, vi } from "vitest";

// Project actions mirror the post actions but with a stricter state
// machine: there is NO self-publish path — every owner write lands in
// "pending" for re-review, and only admins flip approved/archived via
// setProjectVisibility / decideProject. These tests pin that machine,
// the ownership gates, and the deferred Storage cleanup.

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
const userGetMock = vi.fn();
const storageFileDeleteMock = vi.fn();
const adminNewProjectMock = vi.fn();
const decisionMock = vi.fn();
const moderationDecisionMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
  // The action also expires the cached project lists via updateTag; these
  // tests assert on revalidatePath, not tag invalidation, so a no-op stub
  // is enough to satisfy the import.
  updateTag: () => {},
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
  enqueueAdminNewProjectNotification: (...args: unknown[]) =>
    adminNewProjectMock(...args),
  enqueueProjectDecisionNotification: (...args: unknown[]) =>
    decisionMock(...args),
  enqueueModerationDecisionNotification: (...args: unknown[]) =>
    moderationDecisionMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => {
  function projectsCollection() {
    return {
      where: () => ({ limit: () => ({ get: () => slugQueryGetMock() }) }),
      add: (...args: unknown[]) => addMock(...args),
      doc: () => ({
        get: () => docGetMock(),
        update: (...args: unknown[]) => docUpdateMock(...args),
        delete: () => docDeleteMock(),
      }),
    };
  }
  function usersCollection() {
    return { doc: () => ({ get: () => userGetMock() }) };
  }
  return {
    adminDb: () => ({
      collection: (name: string) =>
        name === "projects" ? projectsCollection() : usersCollection(),
    }),
    adminStorage: () => ({
      bucket: () => ({
        file: (p: string) => ({ delete: () => storageFileDeleteMock(p) }),
      }),
    }),
  };
});

import {
  decideProject,
  deleteMyProject,
  setProjectVisibility,
  submitProject,
  updateMyProject,
} from "@/app/actions/projects";

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
  title: "My App",
  description: "A cool demo application",
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
  addMock.mockResolvedValue({ id: "new-project-id" });
  docUpdateMock.mockResolvedValue(undefined);
  docDeleteMock.mockResolvedValue(undefined);
  storageFileDeleteMock.mockResolvedValue(undefined);
  adminNewProjectMock.mockResolvedValue(undefined);
  decisionMock.mockResolvedValue(undefined);
  moderationDecisionMock.mockResolvedValue(undefined);
});

describe("submitProject — validation", () => {
  it("rejects a too-short description with { ok: false } and no write", async () => {
    await expectError(
      submitProject({ ...validInput, description: "short" }),
      "入力エラー",
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed repoUrl", async () => {
    await expectError(
      submitProject({ ...validInput, repoUrl: "not-a-url" }),
      "入力エラー",
    );
  });

  it("accepts blank optional URL fields (preprocessed away, stored as '')", async () => {
    // Per #38, CLI tools / hardware demos have no app URL — the empty
    // string from the form must not trip the .url() validator.
    await expect(
      submitProject({
        ...validInput,
        appUrl: "",
        repoUrl: "",
        demoVideoUrl: "",
      }),
    ).rejects.toThrow("__REDIRECT__:/my/projects");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.appUrl).toBe("");
    expect(payload.repoUrl).toBe("");
    expect(payload.demoVideoUrl).toBe("");
  });
});

describe("submitProject — create", () => {
  it("always lands in 'pending' (no self-publish), notifies admins, redirects", async () => {
    await expect(submitProject(validInput)).rejects.toThrow(
      "__REDIRECT__:/my/projects",
    );
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      slug: "my-app",
      ownerUid: "u1",
      status: "pending",
      reviewerUid: null,
    });
    expect(adminNewProjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "new-project-id" }),
    );
  });

  it("retries the slug with a numeric suffix on collision", async () => {
    slugQueryGetMock
      .mockResolvedValueOnce({ empty: false, docs: [{ id: "other" }] })
      .mockResolvedValueOnce({ empty: true, docs: [] });
    await expect(submitProject(validInput)).rejects.toThrow("__REDIRECT__");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.slug).toBe("my-app-1");
  });
});

describe("updateMyProject — authorization + state machine", () => {
  it("returns projectNotFound for a missing doc", async () => {
    docGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(updateMyProject("p1", validInput), "見つかりません");
  });

  it("refuses a non-owner non-admin edit", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ownerUid: "someone-else", slug: "s", status: "approved" }),
    });
    await expectError(updateMyProject("p1", validInput), "編集する権限");
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("owner edits flip back to 'pending' for re-review (with submittedAt)", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ownerUid: "u1", slug: "s", status: "approved" }),
    });
    await expect(updateMyProject("p1", validInput)).rejects.toThrow(
      "__REDIRECT__:/my/projects",
    );
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("pending");
    expect(patch.submittedAt).toEqual({ __fixed: "now" });
    // The legacy field normalizes away on first save (PR #24).
    expect(patch.thumbnailPath).toBe("__field_delete__");
  });

  it("admin edits preserve the moderation status (typo fix ≠ re-review)", async () => {
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
      data: () => ({ ownerUid: "someone-else", slug: "s", status: "approved" }),
    });
    await expect(
      updateMyProject("p1", validInput, "admin"),
    ).rejects.toThrow("__REDIRECT__:/admin/projects");
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("approved");
    expect(patch).not.toHaveProperty("submittedAt");
  });

  it("sweeps orphaned screenshots + thumbnail from Storage, keeping survivors", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        ownerUid: "u1",
        slug: "s",
        status: "pending",
        thumbnail: { path: "proj/t-old.png", url: "u" },
        screenshots: [
          { path: "proj/s1.png", url: "u" },
          { path: "proj/s2.png", url: "u" },
        ],
      }),
    });
    await expect(
      updateMyProject("p1", {
        ...validInput,
        thumbnail: { path: "proj/t-new.png", url: "https://x/t-new.png" },
        screenshots: [{ path: "proj/s1.png", url: "https://x/s1.png" }],
      }),
    ).rejects.toThrow("__REDIRECT__");
    const deleted = storageFileDeleteMock.mock.calls.map((c) => c[0]);
    expect(deleted).toContain("proj/s2.png");
    expect(deleted).toContain("proj/t-old.png");
    expect(deleted).not.toContain("proj/s1.png");
    expect(deleted).not.toContain("proj/t-new.png");
  });
});

describe("deleteMyProject", () => {
  it("treats an already-missing doc as success", async () => {
    docGetMock.mockResolvedValueOnce({ exists: false });
    await expect(deleteMyProject("p1")).resolves.toEqual({ ok: true });
    expect(docDeleteMock).not.toHaveBeenCalled();
  });

  it("refuses a non-owner non-admin delete", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ownerUid: "someone-else", slug: "s", status: "approved" }),
    });
    await expectError(deleteMyProject("p1"), "削除する権限");
    expect(docDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes the doc, then sweeps thumbnail + all screenshots", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        ownerUid: "u1",
        slug: "s",
        status: "approved",
        thumbnail: { path: "proj/t.png", url: "u" },
        screenshots: [{ path: "proj/s1.png", url: "u" }],
      }),
    });
    await expect(deleteMyProject("p1")).resolves.toEqual({ ok: true });
    expect(docDeleteMock).toHaveBeenCalledTimes(1);
    const deleted = storageFileDeleteMock.mock.calls.map((c) => c[0]);
    expect(deleted).toEqual(
      expect.arrayContaining(["proj/t.png", "proj/s1.png"]),
    );
  });
});

describe("setProjectVisibility / decideProject — admin moderation", () => {
  it("is admin-gated (bubbles FORBIDDEN before any write)", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(setProjectVisibility("p1", true)).rejects.toThrow(
      "FORBIDDEN",
    );
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("visible=true approves and clears any stale review note", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ownerUid: "u1", slug: "s", status: "archived" }),
    });
    await expect(setProjectVisibility("p1", true)).resolves.toEqual({
      ok: true,
    });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch).toMatchObject({
      status: "approved",
      reviewerUid: "admin-1",
      reviewNote: "",
    });
  });

  it("visible=false archives without touching the review note", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ownerUid: "u1", slug: "s", status: "approved" }),
    });
    await expect(setProjectVisibility("p1", false)).resolves.toEqual({
      ok: true,
    });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("archived");
    expect(patch).not.toHaveProperty("reviewNote");
  });

  it("decideProject records the decision and mails the owner with the note", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ ownerUid: "owner-9", title: "T", slug: "s" }),
    });
    userGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ email: "owner@x" }),
    });
    await expect(
      decideProject("p1", "rejected", "screenshots missing"),
    ).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch).toMatchObject({
      status: "rejected",
      reviewerUid: "admin-1",
      reviewNote: "screenshots missing",
    });
    expect(decisionMock).toHaveBeenCalledWith({
      to: "owner@x",
      title: "T",
      decision: "rejected",
      note: "screenshots missing",
    });
    expect(moderationDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUid: "owner-9",
        reason: "project_rejected",
        actorUid: "admin-1",
        parentType: "project",
        parentId: "p1",
        parentTitle: "T",
        parentSlug: "s",
        moderationNote: "screenshots missing",
      }),
    );
  });
});
