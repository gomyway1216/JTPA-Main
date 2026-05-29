import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import { getMyProfile, getPublicProfile } from "@/lib/data/users";

beforeEach(() => {
  mock.reset();
});

describe("getMyProfile", () => {
  it("returns null when no users/{uid} doc exists", async () => {
    // Bootstrap hadn't yet run when the session cookie was minted; the
    // caller should fall back to SessionUser fields.
    mock.setGet({ exists: false });
    expect(await getMyProfile("uid-1")).toBeNull();
  });

  it("returns the full UserProfile when present", async () => {
    mock.setGet({
      exists: true,
      id: "uid-1",
      data: () => ({
        uid: "uid-1",
        email: "a@b",
        displayName: "Alice",
        affiliation: "Corp",
        bio: "hi",
        affiliationPublic: true,
        bioPublic: false,
        emailOptIn: true,
      }),
    });
    const out = await getMyProfile("uid-1");
    expect(out).toMatchObject({
      uid: "uid-1",
      email: "a@b",
      displayName: "Alice",
      affiliation: "Corp",
      bio: "hi",
      affiliationPublic: true,
      bioPublic: false,
      emailOptIn: true,
    });
  });

  it("reads from users/{uid} directly (not via a query)", async () => {
    mock.setGet({ exists: false });
    await getMyProfile("uid-1");
    expect(mock.state.docPath).toEqual({ collection: "users", id: "uid-1" });
    // No where()/orderBy()/limit() calls on the direct-doc path.
    expect(mock.state.whereCalls).toEqual([]);
  });
});

describe("getPublicProfile", () => {
  it("returns null when the user doc is missing", async () => {
    // Distinct from "exists but everything is private": missing user
    // means /u/[uid] should 404 rather than render a stub.
    mock.setGet({ exists: false });
    expect(await getPublicProfile("missing")).toBeNull();
  });

  it("applies the privacy projection (no email, no flags, no timestamps)", async () => {
    // Public view must not leak email or the visibility flags
    // themselves. Mirror of projectPublicProfile's contract.
    mock.setGet({
      exists: true,
      id: "uid-1",
      data: () => ({
        uid: "uid-1",
        email: "secret@example.com",
        displayName: "Alice",
        username: "alice",
        photoURL: "https://x/a.png",
        affiliation: "Corp",
        bio: "hi",
        affiliationPublic: false,
        bioPublic: true,
        // fullNamePublic intentionally false here so the snapshot keeps
        // exercising the "private real name" path; the link bag is
        // empty so we also confirm the projection emits `links: {}`
        // rather than omitting the field.
        fullNamePublic: false,
        links: {},
        emailOptIn: true,
      }),
    });
    const out = await getPublicProfile("uid-1");
    expect(out).toEqual({
      uid: "uid-1",
      username: "alice",
      fullName: null,
      photoURL: "https://x/a.png",
      affiliation: null,
      bio: "hi",
      links: {},
    });
    expect(out).not.toHaveProperty("email");
    expect(out).not.toHaveProperty("affiliationPublic");
    expect(out).not.toHaveProperty("fullNamePublic");
    expect(out).not.toHaveProperty("emailOptIn");
    // displayName is never on the public projection — `fullName` is
    // the gated field, and it's null when the user hasn't opted in.
    expect(out).not.toHaveProperty("displayName");
  });
});
