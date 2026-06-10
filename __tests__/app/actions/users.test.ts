import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// updateMyProfile runs the username claim/release swap inside one
// transaction; updateMyAvatar re-validates the client-supplied
// {path, url} against the caller's own Storage folder; and
// setEventAttendanceCount is an admin-only override with an audit trail.
// The tx mock dispatches get() by the ref's collection/doc id (reads vary
// per branch, so a shift-queue would be brittle here).

const requireUserMock = vi.fn();
const requireAdminMock = vi.fn();
const revalidatePathMock = vi.fn();

const txGetMock = vi.fn();
const txSetMock = vi.fn();
const txUpdateMock = vi.fn();
const txDeleteMock = vi.fn();
const userDocGetMock = vi.fn();
const userDocUpdateMock = vi.fn();
const storageDeleteMock = vi.fn();

// Scripted per test: the users/{uid} snapshot seen INSIDE the
// transaction, and the usernames/{handle} reservation snapshots by id.
let userTxSnap: { exists: boolean; data?: () => unknown };
let usernameSnaps: Record<string, { exists: boolean; data?: () => unknown }>;

// Named impl so beforeEach can re-install it after vi.resetAllMocks().
const runTransactionImpl = async (cb: (tx: unknown) => Promise<unknown>) =>
  cb({
    get: txGetMock,
    set: txSetMock,
    update: txUpdateMock,
    delete: txDeleteMock,
  });
const runTransactionMock = vi.fn(runTransactionImpl);

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "__server_ts__",
    delete: () => "__field_delete__",
  },
  Timestamp: { now: () => ({ __fixed: "now" }) },
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: (col: string) => ({
      doc: (id: string) => ({
        __col: col,
        __id: id,
        get: () => userDocGetMock(),
        update: (...args: unknown[]) => userDocUpdateMock(...args),
      }),
    }),
    runTransaction: (cb: (tx: unknown) => Promise<unknown>) =>
      runTransactionMock(cb),
  }),
  adminStorage: () => ({
    bucket: () => ({
      file: (p: string) => ({ delete: () => storageDeleteMock(p) }),
    }),
  }),
}));

import {
  removeMyAvatar,
  setEventAttendanceCount,
  updateMyAvatar,
  updateMyProfile,
} from "@/app/actions/users";

async function expectError(
  p: Promise<{ ok: true } | { ok: false; error: string }>,
  fragment: string,
) {
  const res = await p;
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("expected an { ok: false } result");
  expect(res.error).toContain(fragment);
}

const baseInput = {
  username: "newname",
  affiliation: "JTPA",
  bio: "Hello there",
  affiliationPublic: true,
  bioPublic: false,
  fullNamePublic: true,
  emailOptIn: false,
  links: {},
};

beforeEach(() => {
  vi.resetAllMocks();
  runTransactionMock.mockImplementation(runTransactionImpl);
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "test-bucket");
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
  userTxSnap = { exists: true, data: () => ({ username: "oldname" }) };
  usernameSnaps = {};
  txGetMock.mockImplementation(
    async (ref: { __col: string; __id: string }) => {
      if (ref.__col === "users") return userTxSnap;
      return usernameSnaps[ref.__id] ?? { exists: false };
    },
  );
  userDocGetMock.mockResolvedValue({ exists: true, data: () => ({}) });
  userDocUpdateMock.mockResolvedValue(undefined);
  storageDeleteMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("updateMyProfile — field validation", () => {
  it("rejects a bio over 1000 chars with the localized message", async () => {
    await expectError(
      updateMyProfile({ ...baseInput, bio: "x".repeat(1001) }),
      "紹介文は1000文字以内",
    );
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) link (ftp:// is a valid URL but a banned protocol)", async () => {
    await expectError(
      updateMyProfile({
        ...baseInput,
        links: { portfolio: "ftp://files.example.com" },
      }),
      "http:// または https://",
    );
  });

  it("rejects a malformed username before touching Firestore", async () => {
    await expectError(
      updateMyProfile({ ...baseInput, username: "Bad Name" }),
      "3〜20文字",
    );
    expect(runTransactionMock).not.toHaveBeenCalled();
  });
});

describe("updateMyProfile — username reservation rules", () => {
  it("blocks a NEW claim of a reserved handle (route-collision guard)", async () => {
    await expectError(
      updateMyProfile({ ...baseInput, username: "admin" }),
      "予約済み",
    );
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("grandfathers a reserved handle the user already holds (no rename)", async () => {
    // Saving the rest of the profile without renaming must not be
    // blocked just because the existing handle predates the rule.
    userTxSnap = { exists: true, data: () => ({ username: "user-aaaaaa" }) };
    await expect(
      updateMyProfile({ ...baseInput, username: "user-aaaaaa" }),
    ).resolves.toEqual({ ok: true });
    expect(txSetMock).not.toHaveBeenCalled();
    expect(txDeleteMock).not.toHaveBeenCalled();
    const [, patch] = txUpdateMock.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(patch.username).toBe("user-aaaaaa");
  });

  it("treats the unclaimed default placeholder as 'no username' (issue #104)", async () => {
    // No stored handle + the form's pre-filled user-{uid} default →
    // keep the field absent rather than claiming a reserved name.
    userTxSnap = { exists: true, data: () => ({}) };
    await expect(
      updateMyProfile({ ...baseInput, username: "user-u1" }),
    ).resolves.toEqual({ ok: true });
    expect(txSetMock).not.toHaveBeenCalled();
    const [, patch] = txUpdateMock.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(patch.username).toBe("__field_delete__");
  });

  it("a rename claims the new slot, releases the old one, and persists the profile", async () => {
    usernameSnaps = {
      oldname: { exists: true, data: () => ({ uid: "u1" }) },
    };
    await expect(
      updateMyProfile({
        ...baseInput,
        links: { portfolio: "https://alice.dev", github: "" },
      }),
    ).resolves.toEqual({ ok: true });

    const [setRef, reservation] = txSetMock.mock.calls[0] as [
      { __col: string; __id: string },
      Record<string, unknown>,
    ];
    expect(setRef).toMatchObject({ __col: "usernames", __id: "newname" });
    expect(reservation).toEqual({ uid: "u1", createdAt: { __fixed: "now" } });

    const [delRef] = txDeleteMock.mock.calls[0] as [
      { __col: string; __id: string },
    ];
    expect(delRef).toMatchObject({ __col: "usernames", __id: "oldname" });

    const [updateRef, patch] = txUpdateMock.mock.calls[0] as [
      { __col: string },
      Record<string, unknown>,
    ];
    expect(updateRef.__col).toBe("users");
    expect(patch).toMatchObject({
      username: "newname",
      affiliation: "JTPA",
      bio: "Hello there",
      affiliationPublic: true,
      bioPublic: false,
      fullNamePublic: true,
      emailOptIn: false,
      updatedAt: "__server_ts__",
    });
    // Blank link slots are stripped — only inhabited URLs persist.
    expect(patch.links).toEqual({ portfolio: "https://alice.dev" });
    // The public profile + event RSVP prefill depend on these fields.
    expect(revalidatePathMock).toHaveBeenCalledWith("/events/[slug]", "page");
    expect(revalidatePathMock).toHaveBeenCalledWith("/u/u1");
  });

  it("returns usernameTaken when someone else owns the desired handle", async () => {
    usernameSnaps = {
      newname: { exists: true, data: () => ({ uid: "someone-else" }) },
    };
    await expectError(updateMyProfile(baseInput), "既に使われています");
    expect(txSetMock).not.toHaveBeenCalled();
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("surfaces a re-login hint when the profile doc is missing", async () => {
    userTxSnap = { exists: false };
    await expectError(updateMyProfile(baseInput), "再ログイン");
  });
});

describe("setEventAttendanceCount — admin override", () => {
  it("is admin-gated (bubbles FORBIDDEN)", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(
      setEventAttendanceCount({ uid: "u2", count: 3 }),
    ).rejects.toThrow("FORBIDDEN");
    expect(userDocUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a negative count", async () => {
    await expectError(
      setEventAttendanceCount({ uid: "u2", count: -1 }),
      "0以上の整数",
    );
    expect(userDocUpdateMock).not.toHaveBeenCalled();
  });

  it("returns userProfileMissing for an unknown uid", async () => {
    userDocGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(
      setEventAttendanceCount({ uid: "ghost", count: 3 }),
      "見つかりません",
    );
  });

  it("writes the count plus an editor audit trail", async () => {
    await expect(
      setEventAttendanceCount({ uid: "u2", count: 5 }),
    ).resolves.toEqual({ ok: true });
    const [patch] = userDocUpdateMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(patch).toEqual({
      eventAttendanceCount: 5,
      eventAttendanceCountEditedAt: { __fixed: "now" },
      eventAttendanceCountEditedBy: {
        uid: "admin-1",
        email: "admin@x",
        displayName: "Admin",
      },
      updatedAt: { __fixed: "now" },
    });
  });
});

describe("updateMyAvatar — client payload re-validation", () => {
  const ownedPath = "users/u1/avatar-2.png";
  const canonicalUrl = `https://firebasestorage.googleapis.com/v0/b/test-bucket/o/${encodeURIComponent(ownedPath)}?alt=media`;

  it("rejects a path outside the caller's own folder", async () => {
    await expectError(
      updateMyAvatar({
        path: "users/u2/avatar.png",
        url: "https://example.com/x.png",
      }),
      "不正なパス",
    );
    expect(userDocUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a download URL on a forged host (even with the right path)", async () => {
    await expectError(
      updateMyAvatar({
        path: ownedPath,
        url: `https://evil.example.com/v0/b/test-bucket/o/${encodeURIComponent(ownedPath)}?alt=media`,
      }),
      "不正なURL",
    );
    expect(userDocUpdateMock).not.toHaveBeenCalled();
  });

  it("repoints the avatar, then sweeps the previous Storage object", async () => {
    userDocGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        avatar: { path: "users/u1/avatar-1.png", url: "old" },
      }),
    });
    await expect(
      updateMyAvatar({ path: ownedPath, url: canonicalUrl }),
    ).resolves.toEqual({ ok: true });
    const [patch] = userDocUpdateMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(patch).toEqual({
      avatar: { path: ownedPath, url: canonicalUrl },
      updatedAt: "__server_ts__",
    });
    expect(storageDeleteMock).toHaveBeenCalledWith("users/u1/avatar-1.png");
  });

  it("does NOT delete the object when re-saving the same path", async () => {
    userDocGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ avatar: { path: ownedPath, url: "old" } }),
    });
    await expect(
      updateMyAvatar({ path: ownedPath, url: canonicalUrl }),
    ).resolves.toEqual({ ok: true });
    expect(storageDeleteMock).not.toHaveBeenCalled();
  });
});

describe("removeMyAvatar", () => {
  it("clears the field and deletes the old Storage object", async () => {
    userDocGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({ avatar: { path: "users/u1/old.png", url: "o" } }),
    });
    await expect(removeMyAvatar()).resolves.toEqual({ ok: true });
    const [patch] = userDocUpdateMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    expect(patch).toEqual({
      avatar: "__field_delete__",
      updatedAt: "__server_ts__",
    });
    expect(storageDeleteMock).toHaveBeenCalledWith("users/u1/old.png");
  });
});
