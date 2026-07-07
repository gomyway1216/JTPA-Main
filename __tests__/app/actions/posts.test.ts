import { beforeEach, describe, expect, it, vi } from "vitest";

// Blog-post actions choreograph Zod validation, ownership checks, the
// author-intent → status state machine, Storage cleanup and admin
// moderation shortcuts. The Firestore writes themselves are choreography —
// these tests pin the authorization rules, the status transitions, and
// the return-not-throw error contract (Next masks thrown Server Action
// errors as a generic digest in production).

const requireUserMock = vi.fn();
const requireAdminMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  // redirectToLocalizedPath calls next/navigation's redirect, which throws
  // to short-circuit rendering; mimic that so success paths never return.
  throw new Error(`__REDIRECT__:${path}`);
});

const slugQueryGetMock = vi.fn();
const addMock = vi.fn();
const docGetMock = vi.fn();
const docUpdateMock = vi.fn();
const docDeleteMock = vi.fn();
const userGetMock = vi.fn();
const auditAddMock = vi.fn();
const batchDeleteMock = vi.fn();
const batchSetMock = vi.fn();
const batchCommitMock = vi.fn();
const storageFileDeleteMock = vi.fn();
const adminNewPostMock = vi.fn();
const decisionMock = vi.fn();
const moderationDecisionMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
  // The action also expires the cached post lists via updateTag; these
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
  enqueueAdminNewPostNotification: (...args: unknown[]) =>
    adminNewPostMock(...args),
  enqueuePostDecisionNotification: (...args: unknown[]) =>
    decisionMock(...args),
  enqueueModerationDecisionNotification: (...args: unknown[]) =>
    moderationDecisionMock(...args),
}));

vi.mock("@/lib/firebase/admin", () => {
  // posts: uniqueSlug walks where().limit().get(); create uses .add();
  // update/delete/moderation walk .doc(id).{get,update,delete}.
  // users: the decision mails read users/{authorUid}.get() for the email.
  function postsCollection() {
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
  function auditLogsCollection() {
    return {
      add: (...args: unknown[]) => auditAddMock(...args),
      doc: () => ({ path: "auditLogs/generated" }),
    };
  }
  return {
    adminDb: () => ({
      collection: (name: string) => {
        if (name === "posts") return postsCollection();
        if (name === "auditLogs") return auditLogsCollection();
        return usersCollection();
      },
      batch: () => ({
        delete: (...args: unknown[]) => batchDeleteMock(...args),
        set: (...args: unknown[]) => batchSetMock(...args),
        commit: () => batchCommitMock(),
      }),
    }),
    adminStorage: () => ({
      bucket: () => ({
        file: (p: string) => ({ delete: () => storageFileDeleteMock(p) }),
      }),
    }),
  };
});

import {
  archivePost,
  decidePost,
  deletePost,
  publishPost,
  submitPost,
  updateMyPost,
} from "@/app/actions/posts";

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
  title: "Hello World",
  excerpt: "A short excerpt",
  body: "Body text",
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
  addMock.mockResolvedValue({ id: "new-post-id" });
  docUpdateMock.mockResolvedValue(undefined);
  docDeleteMock.mockResolvedValue(undefined);
  auditAddMock.mockResolvedValue({ id: "audit-1" });
  batchCommitMock.mockResolvedValue(undefined);
  storageFileDeleteMock.mockResolvedValue(undefined);
  adminNewPostMock.mockResolvedValue(undefined);
  decisionMock.mockResolvedValue(undefined);
  moderationDecisionMock.mockResolvedValue(undefined);
});

describe("submitPost — validation + auth", () => {
  it("returns { ok: false } (not a throw) on invalid input, without writing", async () => {
    await expectError(
      submitPost({ ...validInput, title: "x" }),
      "入力エラー",
    );
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated callers before any write", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    await expect(submitPost(validInput)).rejects.toThrow("UNAUTHENTICATED");
    expect(addMock).not.toHaveBeenCalled();
  });
});

describe("submitPost — create + intent state machine", () => {
  it("defaults to status 'pending', notifies admins, then redirects to /my/posts", async () => {
    await expect(submitPost(validInput)).rejects.toThrow(
      "__REDIRECT__:/my/posts",
    );
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      slug: "hello-world",
      title: "Hello World",
      locales: ["ja"],
      localized: {
        ja: {
          title: "Hello World",
          excerpt: "A short excerpt",
          body: "Body text",
        },
      },
      status: "pending",
      authorUid: "u1",
      authorName: "Alice",
      reviewerUid: null,
    });
    // The admin mail carries the doc id, not the slug.
    expect(adminNewPostMock).toHaveBeenCalledWith(
      expect.objectContaining({ postId: "new-post-id" }),
    );
  });

  it("saves intent 'draft' without pinging the admins", async () => {
    await expect(
      submitPost({ ...validInput, intent: "draft" }),
    ).rejects.toThrow("__REDIRECT__:/my/posts");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.status).toBe("draft");
    expect(adminNewPostMock).not.toHaveBeenCalled();
  });

  it("stores localized English content on create", async () => {
    const en = {
      title: "English Post",
      excerpt: "English excerpt",
      body: "English body",
    };
    await expect(
      submitPost({ localized: { en } }),
    ).rejects.toThrow("__REDIRECT__:/my/posts");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.locales).toEqual(["en"]);
    expect(payload.localized).toEqual({ en });
    expect(payload.title).toBe("English Post");
  });

  it("retries the slug with a numeric suffix when the base slug is taken", async () => {
    slugQueryGetMock
      .mockResolvedValueOnce({ empty: false, docs: [{ id: "someone-else" }] })
      .mockResolvedValueOnce({ empty: true, docs: [] });
    await expect(submitPost(validInput)).rejects.toThrow("__REDIRECT__");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.slug).toBe("hello-world-1");
  });
});

describe("updateMyPost — authorization", () => {
  it("returns postNotFound when the doc is missing", async () => {
    docGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(updateMyPost("p1", validInput), "記事が見つかりません");
  });

  it("refuses a non-owner non-admin edit without writing", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "someone-else", slug: "s", status: "draft" }),
    });
    await expectError(updateMyPost("p1", validInput), "編集する権限");
    expect(docUpdateMock).not.toHaveBeenCalled();
  });
});

describe("updateMyPost — author intent → status", () => {
  it("re-submits for review: intent 'pending' stamps submittedAt and redirects", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "s", status: "rejected" }),
    });
    await expect(
      updateMyPost("p1", { ...validInput, intent: "pending" }),
    ).rejects.toThrow("__REDIRECT__:/my/posts");
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("pending");
    expect(patch.locales).toEqual(["ja"]);
    expect(patch.submittedAt).toEqual({ __fixed: "now" });
  });

  it("saves intent 'draft' without a submittedAt stamp", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "s", status: "pending" }),
    });
    await expect(
      updateMyPost("p1", { ...validInput, intent: "draft" }),
    ).rejects.toThrow("__REDIRECT__");
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("draft");
    expect(patch).not.toHaveProperty("submittedAt");
  });

  it("admin edits preserve the current status (no accidental unpublish)", async () => {
    // The author intent in the payload says 'pending', but an admin
    // typo-fix must not yank a published post back into the queue.
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
      data: () => ({ authorUid: "someone-else", slug: "s", status: "published" }),
    });
    await expect(
      updateMyPost("p1", { ...validInput, intent: "pending" }, "admin"),
    ).rejects.toThrow("__REDIRECT__:/admin/posts");
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("published");
  });

  it("updates localized content", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ authorUid: "u1", slug: "s", status: "draft" }),
    });
    const ja = {
      title: "Hello World",
      excerpt: "A short excerpt",
      body: "Body text",
    };
    const en = {
      title: "English Post",
      excerpt: "English excerpt",
      body: "English body",
    };
    await expect(
      updateMyPost("p1", { localized: { ja, en } }),
    ).rejects.toThrow("__REDIRECT__");
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.locales).toEqual(["ja", "en"]);
    expect(patch.localized).toEqual({ ja, en });
  });

  it("deletes the orphaned old cover image from Storage after a replace", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        authorUid: "u1",
        slug: "s",
        status: "draft",
        coverImage: { path: "posts/p1/old.png", url: "https://x/old.png" },
      }),
    });
    await expect(
      updateMyPost("p1", {
        ...validInput,
        coverImage: { path: "posts/p1/new.png", url: "https://x/new.png" },
      }),
    ).rejects.toThrow("__REDIRECT__");
    expect(storageFileDeleteMock).toHaveBeenCalledWith("posts/p1/old.png");
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.coverImage).toEqual({
      path: "posts/p1/new.png",
      url: "https://x/new.png",
    });
  });
});

describe("deletePost", () => {
  it("refuses even the owning author and records a denied audit log", async () => {
    await expectError(deletePost("p1"), "削除する権限");
    expect(docGetMock).not.toHaveBeenCalled();
    expect(docDeleteMock).not.toHaveBeenCalled();
    expect(auditAddMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "post.delete",
        result: "denied",
        actorUid: "u1",
        actorIsAdmin: false,
        targetType: "post",
        targetId: "p1",
        metadata: { reason: "admin_required" },
      }),
    );
  });

  it("admin treats an already-missing doc as success and records it", async () => {
    requireUserMock.mockResolvedValueOnce({
      uid: "admin-1",
      displayName: "Admin",
      photoURL: null,
      email: "admin@x",
      isAdmin: true,
      isEditor: false,
      isContributor: false,
    });
    docGetMock.mockResolvedValueOnce({ exists: false });
    await expect(deletePost("p1")).resolves.toEqual({ ok: true });
    expect(docDeleteMock).not.toHaveBeenCalled();
    expect(auditAddMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "post.delete",
        result: "not_found",
        actorUid: "admin-1",
        actorIsAdmin: true,
        targetId: "p1",
      }),
    );
  });

  it("admin deletes the doc, records an audit log, sweeps the cover image, and revalidates the detail route", async () => {
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
      data: () => ({
        authorUid: "u1",
        authorName: "Alice",
        title: "Hello",
        slug: "hello",
        status: "published",
        coverImage: { path: "posts/p1/cover.png", url: "https://x/c.png" },
      }),
    });
    await expect(deletePost("p1")).resolves.toEqual({ ok: true });
    expect(docDeleteMock).not.toHaveBeenCalled();
    expect(auditAddMock).not.toHaveBeenCalled();
    expect(batchDeleteMock).toHaveBeenCalledTimes(1);
    expect(batchSetMock).toHaveBeenCalledWith(
      { path: "auditLogs/generated" },
      expect.objectContaining({
        action: "post.delete",
        result: "success",
        actorUid: "admin-1",
        actorIsAdmin: true,
        targetType: "post",
        targetId: "p1",
        targetSlug: "hello",
        targetTitle: "Hello",
        targetStatus: "published",
        targetOwnerUid: "u1",
        targetOwnerName: "Alice",
      }),
    );
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
    expect(storageFileDeleteMock).toHaveBeenCalledWith("posts/p1/cover.png");
    // The now-gone detail route must not keep serving a cached 200.
    expect(revalidatePathMock).toHaveBeenCalledWith("/blog/hello");
  });
});

describe("publishPost / decidePost — admin moderation", () => {
  it("first publish stamps publishedAt and notifies the author", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ slug: "s", title: "T", authorUid: "author-9" }),
    });
    userGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ email: "author@x" }),
    });
    await expect(publishPost("p1")).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch).toMatchObject({
      status: "published",
      reviewerUid: "admin-1",
      publishedAt: { __fixed: "now" },
    });
    expect(decisionMock).toHaveBeenCalledWith({
      to: "author@x",
      title: "T",
      decision: "published",
    });
    expect(moderationDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUid: "author-9",
        reason: "post_published",
        actorUid: "admin-1",
        parentType: "post",
        parentId: "p1",
        parentTitle: "T",
        parentSlug: "s",
      }),
    );
  });

  it("re-publish keeps the original publishedAt and stays silent", async () => {
    // A post edited back to pending and re-approved must not overwrite
    // its first-publish date or re-mail the author.
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        slug: "s",
        title: "T",
        authorUid: "author-9",
        publishedAt: { __fixed: "earlier" },
      }),
    });
    await expect(publishPost("p1")).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty("publishedAt");
    expect(decisionMock).not.toHaveBeenCalled();
  });

  it("rejection stores the note and mails it to the author", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ slug: "s", title: "T", authorUid: "author-9" }),
    });
    userGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ email: "author@x" }),
    });
    await expect(
      decidePost("p1", "rejected", "needs work"),
    ).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.status).toBe("rejected");
    expect(patch.reviewNote).toBe("needs work");
    expect(decisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "rejected", note: "needs work" }),
    );
    expect(moderationDecisionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUid: "author-9",
        reason: "post_rejected",
        moderationNote: "needs work",
      }),
    );
  });

  it("approval clears a stale rejection note and drops the note from the mail", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        slug: "s",
        title: "T",
        authorUid: "author-9",
        reviewNote: "old critique",
      }),
    });
    userGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ email: "author@x" }),
    });
    await expect(
      decidePost("p1", "published", "leftover note"),
    ).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.reviewNote).toBe("");
    expect(decisionMock).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "published", note: undefined }),
    );
  });

  it("archivePost is admin-gated (bubbles FORBIDDEN before any write)", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(archivePost("p1")).rejects.toThrow("FORBIDDEN");
    expect(docUpdateMock).not.toHaveBeenCalled();
  });
});
