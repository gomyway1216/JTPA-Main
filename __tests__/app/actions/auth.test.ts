import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// signInWithIdToken decodes a Firebase ID token, upserts the
// users/{uid} doc (bootstrapping a profile on first login), then mints
// the session cookie. signOut clears the cookie and redirects. Both
// orchestrate several SDKs — stub each edge so we can verify the
// branches.

const verifyIdTokenMock = vi.fn();
const docGetMock = vi.fn();
const docSetMock = vi.fn();
const createSessionCookieMock = vi.fn();
const clearSessionCookieMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  // next/navigation's redirect throws to short-circuit rendering; mimic
  // that so callers downstream don't keep running.
  throw new Error(`__REDIRECT__:${path}`);
});

vi.mock("@/lib/firebase/admin", () => ({
  adminAuth: () => ({
    verifyIdToken: (...args: unknown[]) => verifyIdTokenMock(...args),
  }),
  adminDb: () => ({
    collection: () => ({
      doc: () => ({
        get: () => docGetMock(),
        set: (...args: unknown[]) => docSetMock(...args),
      }),
    }),
  }),
}));

vi.mock("@/lib/auth/session", () => ({
  createSessionCookie: (...args: unknown[]) =>
    createSessionCookieMock(...args),
  clearSessionCookie: () => clearSessionCookieMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

import { signInWithIdToken, signOut } from "@/app/actions/auth";

beforeEach(() => {
  verifyIdTokenMock.mockReset();
  docGetMock.mockReset();
  docSetMock.mockReset().mockResolvedValue(undefined);
  createSessionCookieMock.mockReset().mockResolvedValue(undefined);
  clearSessionCookieMock.mockReset().mockResolvedValue(undefined);
  redirectMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signInWithIdToken — first-time login bootstrap", () => {
  it("creates a default profile with private flags + emailOptIn=true", async () => {
    // Default-private for affiliation/bio so signup doesn't leak
    // anything; emailOptIn defaults to true because that's the
    // long-standing onboarding behavior.
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: "u1",
      email: "alice@example.com",
      name: "Alice",
      picture: "https://x/a.png",
    });
    docGetMock.mockResolvedValueOnce({ exists: false });

    await signInWithIdToken("id-token-xyz");

    expect(verifyIdTokenMock).toHaveBeenCalledWith("id-token-xyz", true);
    expect(docSetMock).toHaveBeenCalledTimes(1);
    // First-time bootstrap uses .set(doc) — no merge option (the
    // second-arg path is `{ merge: true }` and reserved for updates).
    const [profile, opts] = docSetMock.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(opts).toBeUndefined();
    expect(profile).toMatchObject({
      uid: "u1",
      email: "alice@example.com",
      displayName: "Alice",
      photoURL: "https://x/a.png",
      affiliation: "",
      bio: "",
      affiliationPublic: false,
      bioPublic: false,
      // Both new flags must default to private — opting in is the
      // safer bootstrap so signup never silently exposes a real name
      // and never auto-publishes an empty link set.
      fullNamePublic: false,
      links: {},
      emailOptIn: true,
      eventAttendanceCount: 0,
    });
    // `username` is intentionally absent on bootstrap — see the
    // comment in signInWithIdToken for why we let the read-side
    // projection backfill `defaultUsernameFor(uid)` until the user
    // claims a real handle on /my/profile.
    expect(profile).not.toHaveProperty("username");
  });

  it("falls back to email-local-part when displayName is missing", async () => {
    // Apple ID / passwordless flows occasionally land without a name
    // claim — use the email prefix so the profile isn't called "User"
    // forever.
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: "u1",
      email: "alice@example.com",
    });
    docGetMock.mockResolvedValueOnce({ exists: false });
    await signInWithIdToken("token");
    const [profile] = docSetMock.mock.calls[0] as [Record<string, unknown>];
    expect(profile.displayName).toBe("alice");
  });

  it("falls back to literal 'User' when there's no email or name", async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ uid: "u1" });
    docGetMock.mockResolvedValueOnce({ exists: false });
    await signInWithIdToken("token");
    const [profile] = docSetMock.mock.calls[0] as [Record<string, unknown>];
    expect(profile.displayName).toBe("User");
    expect(profile.email).toBe("");
    expect(profile.photoURL).toBeNull();
  });
});

describe("signInWithIdToken — returning user", () => {
  it("merges identity fields without overwriting affiliation/bio", async () => {
    // Returning logins re-sync displayName/email/photoURL from the
    // identity provider but must NOT clobber the user's locally-set
    // affiliation, bio, or visibility flags.
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: "u1",
      email: "new-email@x",
      name: "Updated Name",
      picture: "https://x/new.png",
    });
    docGetMock.mockResolvedValueOnce({
      exists: true,
      get: (field: string) =>
        ({
          email: "old@x",
          displayName: "Old",
          photoURL: "https://x/old.png",
        })[field],
    });

    await signInWithIdToken("token");

    const [patch, opts] = docSetMock.mock.calls[0] as [
      Record<string, unknown>,
      { merge: boolean },
    ];
    expect(opts).toEqual({ merge: true });
    expect(patch).toMatchObject({
      email: "new-email@x",
      displayName: "Updated Name",
      photoURL: "https://x/new.png",
    });
    // Must NOT touch privacy flags or other profile data.
    expect(patch).not.toHaveProperty("affiliation");
    expect(patch).not.toHaveProperty("affiliationPublic");
    expect(patch).not.toHaveProperty("emailOptIn");
  });

  it("keeps the old displayName/email/photoURL when the new claim is missing", async () => {
    // Some providers stop sending name/picture on re-auth; we keep
    // whatever is already on the profile rather than wiping it.
    verifyIdTokenMock.mockResolvedValueOnce({ uid: "u1" });
    docGetMock.mockResolvedValueOnce({
      exists: true,
      get: (field: string) =>
        ({
          email: "old@x",
          displayName: "Old",
          photoURL: "https://x/old.png",
        })[field],
    });

    await signInWithIdToken("token");
    const [patch] = docSetMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.email).toBe("old@x");
    expect(patch.displayName).toBe("Old");
    expect(patch.photoURL).toBe("https://x/old.png");
  });
});

describe("signInWithIdToken — session cookie", () => {
  it("mints the session cookie last (so a bootstrap failure leaves no cookie)", async () => {
    // If the profile write fails, we don't want to leave the user
    // authenticated against a half-existent profile. Order matters.
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: "u1",
      email: "a@b",
    });
    docGetMock.mockResolvedValueOnce({ exists: false });
    docSetMock.mockRejectedValueOnce(new Error("firestore down"));
    await expect(signInWithIdToken("token")).rejects.toThrow("firestore down");
    expect(createSessionCookieMock).not.toHaveBeenCalled();
  });

  it("forwards the verified ID token to createSessionCookie", async () => {
    verifyIdTokenMock.mockResolvedValueOnce({ uid: "u1" });
    docGetMock.mockResolvedValueOnce({ exists: true, get: () => undefined });
    await signInWithIdToken("the-token");
    expect(createSessionCookieMock).toHaveBeenCalledWith("the-token");
  });
});

describe("signOut", () => {
  it("clears the session cookie and redirects to the default locale root", async () => {
    // redirect() throws by design; surface it as the rejection we
    // expect rather than treating it as a real error.
    await expect(signOut()).rejects.toThrow("__REDIRECT__:/ja");
    expect(clearSessionCookieMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/ja");
  });
});
