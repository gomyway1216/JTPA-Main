import { beforeEach, describe, expect, it, vi } from "vitest";

// listAllUsersForAdmin / countAdmins both walk Firebase Auth's
// paginated listUsers(). Stub the SDK with a recorded sequence so we can
// assert pagination cursoring, ISO normalization, the cap behavior, and
// the most-recently-active sort.

const listUsersMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminAuth: () => ({ listUsers: listUsersMock }),
}));

import {
  DEFAULT_USER_CAP,
  countAdmins,
  listAllUsersForAdmin,
} from "@/lib/data/users-admin";

type UserStub = {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
  disabled?: boolean;
  customClaims?: Record<string, unknown>;
  metadata?: { lastSignInTime?: string; creationTime?: string };
};

function user(stub: UserStub) {
  return {
    uid: stub.uid,
    email: stub.email ?? null,
    displayName: stub.displayName ?? null,
    photoURL: stub.photoURL ?? null,
    disabled: stub.disabled ?? false,
    customClaims: stub.customClaims,
    metadata: {
      lastSignInTime: stub.metadata?.lastSignInTime,
      creationTime: stub.metadata?.creationTime,
    },
  };
}

beforeEach(() => {
  listUsersMock.mockReset();
});

describe("listAllUsersForAdmin", () => {
  it("returns an empty list when Auth has no users", async () => {
    listUsersMock.mockResolvedValueOnce({ users: [], pageToken: undefined });
    const { users, truncated } = await listAllUsersForAdmin();
    expect(users).toEqual([]);
    expect(truncated).toBe(false);
  });

  it("maps Auth records into AdminUserListEntry with normalized fields", async () => {
    listUsersMock.mockResolvedValueOnce({
      users: [
        user({
          uid: "u1",
          email: "a@b",
          displayName: "Alice",
          photoURL: "https://x/a.png",
          customClaims: { admin: true, editor: false },
          metadata: {
            // RFC 2822 — Firebase Auth's native format.
            lastSignInTime: "Mon, 01 Jan 2024 12:00:00 GMT",
            creationTime: "Sun, 31 Dec 2023 00:00:00 GMT",
          },
        }),
      ],
      pageToken: undefined,
    });
    const { users } = await listAllUsersForAdmin();
    expect(users).toEqual([
      {
        uid: "u1",
        email: "a@b",
        displayName: "Alice",
        photoURL: "https://x/a.png",
        isAdmin: true,
        isEditor: false,
        disabled: false,
        lastSignInAt: "2024-01-01T12:00:00.000Z",
        createdAt: "2023-12-31T00:00:00.000Z",
      },
    ]);
  });

  it("treats missing email / displayName / photoURL as defaults ('', null, null)", async () => {
    listUsersMock.mockResolvedValueOnce({
      users: [user({ uid: "u1" })],
      pageToken: undefined,
    });
    const { users } = await listAllUsersForAdmin();
    expect(users[0]).toMatchObject({
      email: "",
      displayName: null,
      photoURL: null,
      isAdmin: false,
      isEditor: false,
    });
  });

  it("returns null for un-parseable timestamps without throwing", async () => {
    // Auth metadata occasionally returns garbage for never-signed-in
    // users; we'd rather render "—" than blow up the admin page.
    listUsersMock.mockResolvedValueOnce({
      users: [
        user({
          uid: "u1",
          metadata: {
            lastSignInTime: "not a date",
            creationTime: undefined,
          },
        }),
      ],
      pageToken: undefined,
    });
    const { users } = await listAllUsersForAdmin();
    expect(users[0].lastSignInAt).toBeNull();
    expect(users[0].createdAt).toBeNull();
  });

  it("sorts most-recently-active first (and treats null lastSignInAt as oldest)", async () => {
    listUsersMock.mockResolvedValueOnce({
      users: [
        user({
          uid: "old",
          metadata: { lastSignInTime: "Mon, 01 Jan 2024 00:00:00 GMT" },
        }),
        user({ uid: "never" }), // null lastSignInAt sinks to the bottom
        user({
          uid: "new",
          metadata: { lastSignInTime: "Wed, 01 Jan 2025 00:00:00 GMT" },
        }),
      ],
      pageToken: undefined,
    });
    const { users } = await listAllUsersForAdmin();
    expect(users.map((u) => u.uid)).toEqual(["new", "old", "never"]);
  });

  it("follows pageToken across multiple Auth pages", async () => {
    listUsersMock
      .mockResolvedValueOnce({
        users: [user({ uid: "a" })],
        pageToken: "tok-1",
      })
      .mockResolvedValueOnce({
        users: [user({ uid: "b" })],
        pageToken: undefined,
      });
    const { users, truncated } = await listAllUsersForAdmin(5000);
    expect(users.map((u) => u.uid).sort()).toEqual(["a", "b"]);
    expect(truncated).toBe(false);
    // Second call must pass the token from the first response.
    expect(listUsersMock.mock.calls[1][1]).toBe("tok-1");
  });

  it("stops once cap is reached and marks the result truncated", async () => {
    // Two pages of 2 users each, cap=3 → take everyone from page 1
    // and one from page 2, then stop with truncated=true.
    listUsersMock
      .mockResolvedValueOnce({
        users: [user({ uid: "a" }), user({ uid: "b" })],
        pageToken: "tok-1",
      })
      .mockResolvedValueOnce({
        users: [user({ uid: "c" }), user({ uid: "d" })],
        pageToken: "tok-2",
      });
    const { users, truncated } = await listAllUsersForAdmin(3);
    expect(users).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it("DEFAULT_USER_CAP is at least the single-page max", async () => {
    // Below 1000 the cap would force unnecessary truncation even on a
    // small instance.
    expect(DEFAULT_USER_CAP).toBeGreaterThanOrEqual(1000);
  });
});

describe("countAdmins", () => {
  it("returns 0 when no users hold the admin claim", async () => {
    listUsersMock.mockResolvedValueOnce({
      users: [
        user({ uid: "a", customClaims: { editor: true } }),
        user({ uid: "b" }),
      ],
      pageToken: undefined,
    });
    expect(await countAdmins()).toBe(0);
  });

  it("counts admins across every page of listUsers", async () => {
    listUsersMock
      .mockResolvedValueOnce({
        users: [
          user({ uid: "a", customClaims: { admin: true } }),
          user({ uid: "b" }),
        ],
        pageToken: "tok-1",
      })
      .mockResolvedValueOnce({
        users: [user({ uid: "c", customClaims: { admin: true } })],
        pageToken: undefined,
      });
    expect(await countAdmins()).toBe(2);
  });

  it("requires admin === true (not just truthy)", async () => {
    // A user with `{ admin: 1 }` must NOT count — matches the verify
    // path which also requires literal true.
    listUsersMock.mockResolvedValueOnce({
      users: [
        user({ uid: "a", customClaims: { admin: 1 as unknown as boolean } }),
        user({ uid: "b", customClaims: { admin: "yes" as unknown as boolean } }),
      ],
      pageToken: undefined,
    });
    expect(await countAdmins()).toBe(0);
  });
});
