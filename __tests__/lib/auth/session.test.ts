import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// session.ts wires together next/headers cookies(), the Admin Auth SDK,
// and React's request-scoped cache(). Stub both edges so we can exercise
// the cookie-set / verify / claim-extraction logic without standing up
// a Next.js runtime.

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
}));

const createSessionCookieMock = vi.fn();
const verifySessionCookieMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminAuth: () => ({
    createSessionCookie: createSessionCookieMock,
    verifySessionCookie: verifySessionCookieMock,
  }),
}));

async function importFresh() {
  // React's cache() memoizes per-request — between tests we need to throw
  // out the cached memo so a fresh getSessionUser() actually runs.
  vi.resetModules();
  return await import("@/lib/auth/session");
}

beforeEach(() => {
  cookieStore.get.mockReset();
  cookieStore.set.mockReset();
  cookieStore.delete.mockReset();
  createSessionCookieMock.mockReset();
  verifySessionCookieMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createSessionCookie", () => {
  it("calls Admin SDK with milliseconds and writes a hardened cookie", async () => {
    createSessionCookieMock.mockResolvedValueOnce("session-jwt");
    const { createSessionCookie } = await importFresh();

    await createSessionCookie("id-token-123");

    expect(createSessionCookieMock).toHaveBeenCalledWith("id-token-123", {
      // The Admin SDK takes expiresIn in MILLISECONDS — not seconds — so
      // a regression that drops the *1000 would let the cookie expire
      // 1000× too early. Worth pinning the exact value.
      expiresIn: 60 * 60 * 24 * 5 * 1000,
    });

    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieStore.set.mock.calls[0] as [
      string,
      string,
      {
        httpOnly: boolean;
        secure: boolean;
        sameSite: string;
        path: string;
        maxAge: number;
      },
    ];
    expect(name).toBe("__session");
    expect(value).toBe("session-jwt");
    expect(opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 5,
    });
  });

  it("marks the cookie secure only when NODE_ENV === 'production'", async () => {
    vi.stubEnv("NODE_ENV", "production");
    createSessionCookieMock.mockResolvedValueOnce("session-jwt");
    const { createSessionCookie } = await importFresh();
    await createSessionCookie("id-token");
    const [, , opts] = cookieStore.set.mock.calls[0] as [
      string,
      string,
      { secure: boolean },
    ];
    expect(opts.secure).toBe(true);
  });

  it("leaves secure=false in non-production so dev over http works", async () => {
    vi.stubEnv("NODE_ENV", "development");
    createSessionCookieMock.mockResolvedValueOnce("session-jwt");
    const { createSessionCookie } = await importFresh();
    await createSessionCookie("id-token");
    const [, , opts] = cookieStore.set.mock.calls[0] as [
      string,
      string,
      { secure: boolean },
    ];
    expect(opts.secure).toBe(false);
  });
});

describe("clearSessionCookie", () => {
  it("deletes the __session cookie by name", async () => {
    const { clearSessionCookie } = await importFresh();
    await clearSessionCookie();
    expect(cookieStore.delete).toHaveBeenCalledWith("__session");
  });
});

describe("getSessionUser", () => {
  it("returns null when the cookie is absent", async () => {
    cookieStore.get.mockReturnValueOnce(undefined);
    const { getSessionUser } = await importFresh();
    expect(await getSessionUser()).toBeNull();
    // Skipping the verify call when the cookie is missing keeps anon
    // visitors off the Admin SDK hot path.
    expect(verifySessionCookieMock).not.toHaveBeenCalled();
  });

  it("returns null and swallows the error when verify throws", async () => {
    // Verify failures (expired / tampered cookie / revoked) must NOT
    // bubble up as a 500 — they're just "not signed in".
    cookieStore.get.mockReturnValueOnce({ value: "rotten" });
    verifySessionCookieMock.mockRejectedValueOnce(new Error("revoked"));
    const { getSessionUser } = await importFresh();
    expect(await getSessionUser()).toBeNull();
  });

  it("passes checkRevoked=true to the verifier", async () => {
    // Without checkRevoked, a signed-out user's session cookie would
    // still authenticate. Pin the second arg.
    cookieStore.get.mockReturnValueOnce({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValueOnce({
      uid: "u1",
      email: "a@b",
    });
    const { getSessionUser } = await importFresh();
    await getSessionUser();
    expect(verifySessionCookieMock).toHaveBeenCalledWith("cookie", true);
  });

  it("returns a fully-populated SessionUser when decoded", async () => {
    cookieStore.get.mockReturnValueOnce({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValueOnce({
      uid: "u1",
      email: "a@b",
      name: "Alice",
      picture: "https://x/a.png",
      admin: true,
      editor: true,
    });
    const { getSessionUser } = await importFresh();
    expect(await getSessionUser()).toEqual({
      uid: "u1",
      email: "a@b",
      displayName: "Alice",
      photoURL: "https://x/a.png",
      isAdmin: true,
      isEditor: true,
    });
  });

  it("treats missing email / name as empty string, missing picture as null", async () => {
    // Older accounts (Apple ID, anonymous-converted) can have empty
    // claim fields. Public APIs must accept that without choking.
    cookieStore.get.mockReturnValueOnce({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValueOnce({ uid: "u1" });
    const { getSessionUser } = await importFresh();
    const out = await getSessionUser();
    expect(out).toEqual({
      uid: "u1",
      email: "",
      displayName: "",
      photoURL: null,
      isAdmin: false,
      isEditor: false,
    });
  });

  it("treats non-true admin/editor claims as false (no truthy coercion)", async () => {
    // The cookie format is the source of truth: a value like `1` or
    // `"yes"` must NOT grant admin. Only the literal boolean `true`
    // counts.
    cookieStore.get.mockReturnValueOnce({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValueOnce({
      uid: "u1",
      admin: 1,
      editor: "yes",
    });
    const { getSessionUser } = await importFresh();
    const out = await getSessionUser();
    expect(out?.isAdmin).toBe(false);
    expect(out?.isEditor).toBe(false);
  });
});

describe("requireUser / requireAdmin / requireEditor", () => {
  it("requireUser throws UNAUTHENTICATED when no session", async () => {
    cookieStore.get.mockReturnValue(undefined);
    const { requireUser } = await importFresh();
    await expect(requireUser()).rejects.toThrow("UNAUTHENTICATED");
  });

  it("requireUser returns the decoded user when signed in", async () => {
    cookieStore.get.mockReturnValue({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValue({ uid: "u1" });
    const { requireUser } = await importFresh();
    const user = await requireUser();
    expect(user.uid).toBe("u1");
  });

  it("requireAdmin throws FORBIDDEN for a non-admin user", async () => {
    cookieStore.get.mockReturnValue({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValue({ uid: "u1" });
    const { requireAdmin } = await importFresh();
    await expect(requireAdmin()).rejects.toThrow("FORBIDDEN");
  });

  it("requireAdmin passes through when admin claim is true", async () => {
    cookieStore.get.mockReturnValue({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValue({ uid: "u1", admin: true });
    const { requireAdmin } = await importFresh();
    const out = await requireAdmin();
    expect(out.isAdmin).toBe(true);
  });

  it("requireEditor accepts either admin OR editor", async () => {
    cookieStore.get.mockReturnValue({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValue({ uid: "u1", editor: true });
    const { requireEditor } = await importFresh();
    const out = await requireEditor();
    expect(out.isEditor).toBe(true);
  });

  it("requireEditor accepts admin-only users (admin implies editor powers)", async () => {
    cookieStore.get.mockReturnValue({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValue({ uid: "u1", admin: true });
    const { requireEditor } = await importFresh();
    const out = await requireEditor();
    expect(out.isAdmin).toBe(true);
  });

  it("requireEditor throws FORBIDDEN when neither claim is set", async () => {
    cookieStore.get.mockReturnValue({ value: "cookie" });
    verifySessionCookieMock.mockResolvedValue({ uid: "u1" });
    const { requireEditor } = await importFresh();
    await expect(requireEditor()).rejects.toThrow("FORBIDDEN");
  });

  it("requireEditor still throws UNAUTHENTICATED for anonymous visitors", async () => {
    // Two distinct error sentinels — anonymous vs role-gated — so the
    // UI can render the right message for each.
    cookieStore.get.mockReturnValue(undefined);
    const { requireEditor } = await importFresh();
    await expect(requireEditor()).rejects.toThrow("UNAUTHENTICATED");
  });
});
