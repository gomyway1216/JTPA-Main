import { beforeEach, describe, expect, it, vi } from "vitest";

// setUserRole choreographs Auth claims + a Firestore audit write. The
// interesting business rules (last-admin guard, race-safety self-heal,
// self-revoke guard, idempotent no-op) live in the function body — we
// stub the SDKs and verify each branch.

const getUserMock = vi.fn();
const setCustomUserClaimsMock = vi.fn();
const updateMock = vi.fn();
const countAdminsMock = vi.fn();
const requireAdminMock = vi.fn();
const revalidatePathMock = vi.fn();

// vi.mock factories are hoisted above imports, so the *Mock consts
// above are still in TDZ when the factory runs. Wrap every exported
// function in a thunk that only deref's the mock when called — by then
// the consts are initialized.
vi.mock("@/lib/auth/session", () => ({
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("@/lib/data/users-admin", () => ({
  countAdmins: () => countAdminsMock(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminAuth: () => ({
    getUser: (...args: unknown[]) => getUserMock(...args),
    setCustomUserClaims: (...args: unknown[]) =>
      setCustomUserClaimsMock(...args),
  }),
  adminDb: () => ({
    collection: () => ({
      doc: () => ({ update: (...args: unknown[]) => updateMock(...args) }),
    }),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => "__server_ts__",
  },
}));

import { setUserRole } from "@/app/actions/roles";

// setUserRole now *returns* { ok: false, error } instead of throwing, so the
// real reason reaches the admin (Next masks thrown Server Action errors as a
// generic digest in production). This helper asserts a failed result carries
// the expected message fragment.
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
  getUserMock.mockReset();
  setCustomUserClaimsMock.mockReset();
  updateMock.mockReset();
  countAdminsMock.mockReset();
  requireAdminMock.mockReset();
  revalidatePathMock.mockReset();
  // Default actor: a different admin (so self-revoke guard doesn't trip
  // unless the test explicitly wants it).
  requireAdminMock.mockResolvedValue({
    uid: "actor",
    email: "actor@x",
    displayName: "Actor",
  });
  setCustomUserClaimsMock.mockResolvedValue(undefined);
  updateMock.mockResolvedValue(undefined);
});

describe("setUserRole — input validation", () => {
  it("rejects an empty uid", async () => {
    await expectError(
      setUserRole({ uid: "", role: "admin", grant: true }),
      "uid",
    );
  });

  it("rejects an unknown role (prevents __proto__ etc. slipping through)", async () => {
    // Server Actions can be invoked with any payload; TypeScript only
    // protects compile-time callers. The allowlist check stops
    // someone setting `customClaims.__proto__ = true`.
    await expectError(
      setUserRole({
        uid: "u1",
        role: "__proto__" as never,
        grant: true,
      }),
      "不正なロール",
    );
  });

  it("rejects when grant isn't a boolean", async () => {
    await expectError(
      setUserRole({
        uid: "u1",
        role: "admin",
        grant: "yes" as unknown as boolean,
      }),
      "boolean",
    );
  });
});

describe("setUserRole — idempotent no-op", () => {
  it("returns without writing when grant matches current state", async () => {
    // Granting admin to an existing admin: skip every side effect,
    // including the countAdmins() walk.
    getUserMock.mockResolvedValueOnce({
      customClaims: { admin: true },
    });
    await setUserRole({ uid: "u1", role: "admin", grant: true });
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
    expect(countAdminsMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("short-circuits a no-op revoke against a non-admin (no count call)", async () => {
    // Per the comment in roles.ts: this branch protects the
    // last-admin check from misfiring + spares a listUsers walk.
    getUserMock.mockResolvedValueOnce({ customClaims: {} });
    await setUserRole({ uid: "u1", role: "admin", grant: false });
    expect(countAdminsMock).not.toHaveBeenCalled();
  });
});

describe("setUserRole — admin self-revoke guard", () => {
  it("refuses when the actor is revoking their own admin role", async () => {
    // The admin can't lock themselves out by mistake.
    requireAdminMock.mockResolvedValueOnce({
      uid: "u1",
      email: "u1@x",
      displayName: "Self",
    });
    getUserMock.mockResolvedValueOnce({
      customClaims: { admin: true },
    });
    await expectError(
      setUserRole({ uid: "u1", role: "admin", grant: false }),
      "自分自身",
    );
    // We bail BEFORE touching Auth, even though the no-op short-circuit
    // didn't fire.
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
  });
});

describe("setUserRole — last-admin protection", () => {
  it("refuses to revoke when only one admin remains", async () => {
    // adminCount <= 1: prevent locking everyone out of the admin
    // surface.
    getUserMock.mockResolvedValueOnce({
      customClaims: { admin: true },
    });
    countAdminsMock.mockResolvedValueOnce(1);
    await expectError(
      setUserRole({ uid: "u1", role: "admin", grant: false }),
      "最後の admin",
    );
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
  });

  it("allows revoke when at least two admins exist", async () => {
    getUserMock.mockResolvedValueOnce({
      customClaims: { admin: true },
    });
    // Pre-check passes (>1), and the post-write re-check still shows >0
    // remaining (no race triggered).
    countAdminsMock.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    await setUserRole({ uid: "u1", role: "admin", grant: false });
    // claims object passed to setCustomUserClaims must NOT contain admin.
    const [uid, nextClaims] = setCustomUserClaimsMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(uid).toBe("u1");
    expect(nextClaims.admin).toBeUndefined();
  });

  it("self-heals when a concurrent revoke zeroed out the admin set", async () => {
    // Two admins race-revoke each other: both observe count=2, both
    // proceed. After our write the count comes back as 0 — we restore
    // this user's claim and surface a retryable error.
    getUserMock.mockResolvedValueOnce({
      customClaims: { admin: true },
    });
    countAdminsMock.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    await expectError(
      setUserRole({ uid: "u1", role: "admin", grant: false }),
      "もう一度",
    );

    // Should have called setCustomUserClaims TWICE: once to revoke,
    // once to restore.
    expect(setCustomUserClaimsMock).toHaveBeenCalledTimes(2);
    const restoreCall = setCustomUserClaimsMock.mock.calls[1] as [
      string,
      Record<string, unknown>,
    ];
    expect(restoreCall[1].admin).toBe(true);
  });
});

describe("setUserRole — happy paths", () => {
  it("grants editor without invoking the last-admin guard", async () => {
    // Editor doesn't gate the system, so no countAdmins() call.
    getUserMock.mockResolvedValueOnce({ customClaims: {} });
    await setUserRole({ uid: "u1", role: "editor", grant: true });
    expect(countAdminsMock).not.toHaveBeenCalled();
    const [uid, nextClaims] = setCustomUserClaimsMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(uid).toBe("u1");
    expect(nextClaims).toEqual({ editor: true });
  });

  it("preserves unrelated existing claims when granting", async () => {
    // Don't clobber whatever else is on the user (e.g. editor when
    // we're flipping admin).
    getUserMock.mockResolvedValueOnce({
      customClaims: { editor: true, other: "x" },
    });
    await setUserRole({ uid: "u1", role: "admin", grant: true });
    const next = setCustomUserClaimsMock.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(next).toEqual({ editor: true, other: "x", admin: true });
  });

  it("writes an audit trail to users/{uid} on success", async () => {
    getUserMock.mockResolvedValueOnce({ customClaims: {} });
    await setUserRole({ uid: "u1", role: "editor", grant: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
    const audit = updateMock.mock.calls[0][0] as {
      roleChangedAt: string;
      roleChangedBy: { uid: string; email: string | null };
    };
    expect(audit.roleChangedAt).toBe("__server_ts__");
    expect(audit.roleChangedBy.uid).toBe("actor");
    expect(audit.roleChangedBy.email).toBe("actor@x");
  });

  it("survives a missing profile doc on the audit write (NOT_FOUND)", async () => {
    // If the target never signed in via AuthProvider their profile
    // doc doesn't exist — the role change has already landed, the
    // audit is best-effort, and we must not surface the error.
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    getUserMock.mockResolvedValueOnce({ customClaims: {} });
    updateMock.mockRejectedValueOnce(new Error("NOT_FOUND"));
    // The role change still succeeds — the audit write is best-effort, so
    // the result is { ok: true } even when the profile doc is missing.
    await expect(
      setUserRole({ uid: "u1", role: "editor", grant: true }),
    ).resolves.toEqual({ ok: true });
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("revalidates /admin/users on success", async () => {
    getUserMock.mockResolvedValueOnce({ customClaims: {} });
    await setUserRole({ uid: "u1", role: "editor", grant: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/users");
  });
});
