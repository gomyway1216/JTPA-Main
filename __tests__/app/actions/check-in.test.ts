import { beforeEach, describe, expect, it, vi } from "vitest";

// The check-in actions gate on token + time-window (validated via the
// REAL @/lib/check-in helpers — the pure window math has its own tests
// in __tests__/lib/check-in.test.ts), then move three denormalized
// counters transactionally: the event's attendanceCount/rsvpCount and
// the user's eventAttendanceCount. Mock runTransaction with a tx whose
// .get() dispatches scripted snapshots by ref, and assert the writes.

const requireUserMock = vi.fn();
const requireAdminMock = vi.fn();
const getUserMock = vi.fn();
const revalidatePathMock = vi.fn();

const eventGetMock = vi.fn(); // direct (non-tx) read in generateCheckInToken
const eventUpdateMock = vi.fn(); // direct (non-tx) write in generateCheckInToken

const txGetMock = vi.fn();
const txSetMock = vi.fn();
const txUpdateMock = vi.fn();
const runTransactionMock = vi.fn(
  async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ get: txGetMock, set: txSetMock, update: txUpdateMock }),
);

const rsvpRef = { __kind: "rsvp" };
const userRef = { __kind: "user" };
const eventRef = {
  __kind: "event",
  get: () => eventGetMock(),
  update: (...args: unknown[]) => eventUpdateMock(...args),
  collection: (name: string) => {
    if (name !== "rsvps") throw new Error(`unexpected subcollection: ${name}`);
    return { doc: () => rsvpRef };
  },
};

let eventSnap: { exists: boolean; data: () => unknown };
let rsvpSnap: { exists: boolean; data: () => unknown };
let userSnap: { exists: boolean; get: (field: string) => unknown };

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
  // The action also expires the cached event lists via updateTag; these
  // tests assert on revalidatePath, not tag invalidation, so a no-op stub
  // is enough to satisfy the import.
  updateTag: () => {},
}));

vi.mock("firebase-admin/firestore", () => ({
  // selfCheckIn stores `now.toDate()` on the event patch, so the
  // Timestamp stub needs a toDate(). JSON-plainify drops the function,
  // leaving the __fixed marker for result assertions.
  Timestamp: {
    now: () => ({ __fixed: "now", toDate: () => new Date(0) }),
  },
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    delete: () => "__delete__",
  },
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminAuth: () => ({
    getUser: (...args: unknown[]) => getUserMock(...args),
  }),
  adminDb: () => ({
    collection: (name: string) => {
      if (name === "events") return { doc: () => eventRef };
      if (name === "users") return { doc: () => userRef };
      throw new Error(`unexpected collection: ${name}`);
    },
    runTransaction: (cb: (tx: unknown) => Promise<unknown>) =>
      runTransactionMock(cb),
  }),
}));

import {
  addAdminAttendee,
  generateCheckInToken,
  selfCheckIn,
  setAttendance,
} from "@/app/actions/check-in";

const HOUR = 60 * 60 * 1000;

function snap(data: Record<string, unknown> | null) {
  return data
    ? { exists: true, data: () => data }
    : { exists: false, data: () => undefined };
}

// Default: the event is running right now, so the default check-in
// window (4h before start … 6h after end) is open.
function eventData(overrides: Record<string, unknown> = {}) {
  return {
    slug: "jtpa-salon",
    title: "JTPA Salon",
    status: "published",
    checkInToken: "valid-token",
    startAt: new Date(Date.now() - HOUR),
    endAt: new Date(Date.now() + HOUR),
    ...overrides,
  };
}

function updateTo(kind: string): Record<string, unknown> | undefined {
  const call = txUpdateMock.mock.calls.find(
    ([ref]) => (ref as { __kind?: string }).__kind === kind,
  );
  return call?.[1] as Record<string, unknown> | undefined;
}

function txGetKinds(): string[] {
  return txGetMock.mock.calls.map(
    ([ref]) => (ref as { __kind: string }).__kind,
  );
}

beforeEach(() => {
  requireUserMock.mockReset().mockResolvedValue({
    uid: "u1",
    displayName: "Alice",
    email: "alice@x",
    photoURL: null,
    isAdmin: false,
    isEditor: false,
  });
  requireAdminMock.mockReset().mockResolvedValue({
    uid: "admin-1",
    displayName: "Admin",
    email: "admin@x",
    isAdmin: true,
  });
  getUserMock.mockReset().mockResolvedValue({
    uid: "u2",
    displayName: "Bob",
    email: "bob@x",
  });
  revalidatePathMock.mockReset();
  eventGetMock.mockReset();
  eventUpdateMock.mockReset().mockResolvedValue(undefined);
  txSetMock.mockReset();
  txUpdateMock.mockReset();
  runTransactionMock.mockClear();
  txGetMock
    .mockReset()
    .mockImplementation(async (target: { __kind?: string }) => {
      switch (target.__kind) {
        case "event":
          return eventSnap;
        case "rsvp":
          return rsvpSnap;
        case "user":
          return userSnap;
        default:
          throw new Error("test bug: unexpected tx.get target");
      }
    });
  eventSnap = snap(eventData());
  rsvpSnap = snap(null);
  userSnap = {
    exists: true,
    get: (field: string) =>
      ({ eventAttendanceCount: 3 } as Record<string, unknown>)[field],
  };
});

describe("generateCheckInToken", () => {
  it("is admin-gated", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(generateCheckInToken("e1")).rejects.toThrow("FORBIDDEN");
    expect(eventUpdateMock).not.toHaveBeenCalled();
  });

  it("throws EVENT_NOT_FOUND for a missing event", async () => {
    eventGetMock.mockResolvedValueOnce({ exists: false });
    await expect(generateCheckInToken("e1")).rejects.toThrow(
      "EVENT_NOT_FOUND",
    );
    expect(eventUpdateMock).not.toHaveBeenCalled();
  });

  it("persists and returns a fresh 16-char token, then revalidates the QR page", async () => {
    eventGetMock.mockResolvedValueOnce(snap(eventData()));
    const token = await generateCheckInToken("e1");
    // Real generateCheckInTokenString(): 16 chars from the QR-friendly
    // alphabet (~96 bits — see src/lib/check-in.ts).
    expect(token).toMatch(/^[A-Za-z0-9]{16}$/);
    const [patch] = eventUpdateMock.mock.calls[0] as [
      Record<string, unknown>,
    ];
    // The persisted token IS the returned one — the admin page renders
    // the QR from the return value without a refetch.
    expect(patch.checkInToken).toBe(token);
    expect(revalidatePathMock).toHaveBeenCalledWith(
      "/admin/events/e1/checkin",
    );
  });
});

describe("selfCheckIn — token + window validation", () => {
  it("rejects an unauthenticated caller before opening a transaction", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    await expect(selfCheckIn("e1", "valid-token")).rejects.toThrow(
      "UNAUTHENTICATED",
    );
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects a wrong/rotated token without writing anything", async () => {
    // Admin regenerating the token must invalidate QR codes in the wild.
    await expect(selfCheckIn("e1", "leaked-old-token")).rejects.toThrow(
      "INVALID_TOKEN",
    );
    expect(txSetMock).not.toHaveBeenCalled();
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects when no token was ever generated for the event", async () => {
    eventSnap = snap(eventData({ checkInToken: undefined }));
    await expect(selfCheckIn("e1", "anything")).rejects.toThrow(
      "TOKEN_NOT_SET",
    );
  });

  it("rejects check-ins on a cancelled event", async () => {
    eventSnap = snap(eventData({ status: "cancelled" }));
    await expect(selfCheckIn("e1", "valid-token")).rejects.toThrow(
      "EVENT_CANCELLED",
    );
  });

  it("rejects scans outside the allowed time window", async () => {
    // 5h before start is outside the default 4h early window…
    eventSnap = snap(
      eventData({
        startAt: new Date(Date.now() + 5 * HOUR),
        endAt: new Date(Date.now() + 7 * HOUR),
      }),
    );
    await expect(selfCheckIn("e1", "valid-token")).rejects.toThrow(
      "TOO_EARLY",
    );
    // …and 7h after end is outside the default 6h late window.
    eventSnap = snap(
      eventData({
        startAt: new Date(Date.now() - 9 * HOUR),
        endAt: new Date(Date.now() - 7 * HOUR),
      }),
    );
    await expect(selfCheckIn("e1", "valid-token")).rejects.toThrow(
      "TOO_LATE",
    );
    expect(txSetMock).not.toHaveBeenCalled();
  });
});

describe("selfCheckIn — registration + counters", () => {
  it("auto-registers a walk-in: confirmed RSVP + rsvpCount + attendanceCount", async () => {
    // The QR flow creates the registration on the spot for users who
    // never RSVP'd — walk-ins go straight to confirmed even if the
    // event is over capacity (they're physically present).
    const res = await selfCheckIn("e1", "valid-token");
    expect(res.alreadyCheckedIn).toBe(false);
    expect(res.rsvp).toMatchObject({
      uid: "u1",
      displayName: "Alice",
      email: "alice@x",
      role: "attendee",
      status: "confirmed",
      surveyResponses: {},
      attendedAt: { __fixed: "now" },
    });
    expect(txSetMock).toHaveBeenCalledWith(rsvpRef, expect.anything());
    const patch = updateTo("event");
    expect(patch).toMatchObject({
      rsvpCount: { __inc: 1 },
      attendanceCount: { __inc: 1 },
    });
    // A brand-new attendee never moves waitlist/presenter counters.
    expect(patch).not.toHaveProperty("waitlistCount");
    expect(patch).not.toHaveProperty("presenterCount");
    // users/{uid} lifetime counter: 3 → 4.
    expect(updateTo("user")).toMatchObject({ eventAttendanceCount: 4 });
  });

  it("is idempotent: a second scan changes no counters", async () => {
    rsvpSnap = snap({
      status: "confirmed",
      role: "attendee",
      displayName: "Prior Name",
      email: "prior@x",
      surveyResponses: { q1: "a" },
      attendedAt: { __fixed: "earlier" },
      createdAt: { __fixed: "created" },
    });
    const res = await selfCheckIn("e1", "valid-token");
    expect(res.alreadyCheckedIn).toBe(true);
    // The original check-in moment is preserved, not overwritten.
    expect(res.rsvp.attendedAt).toEqual({ __fixed: "earlier" });
    // No counter movement at all — and the user doc isn't even read.
    expect(txUpdateMock).not.toHaveBeenCalled();
    expect(txGetKinds()).not.toContain("user");
  });

  it("checks in a pre-registered attendee without re-counting the RSVP", async () => {
    rsvpSnap = snap({
      status: "confirmed",
      role: "attendee",
      displayName: "Prior Name",
      email: "prior@x",
      affiliation: "ACME",
      surveyResponses: { q1: "a" },
      createdAt: { __fixed: "created" },
    });
    const res = await selfCheckIn("e1", "valid-token");
    expect(res.alreadyCheckedIn).toBe(false);
    const patch = updateTo("event");
    expect(patch).toMatchObject({ attendanceCount: { __inc: 1 } });
    expect(patch).not.toHaveProperty("rsvpCount");
    // The walk-in rewrite keeps what they registered with.
    const [, doc] = txSetMock.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(doc).toMatchObject({
      displayName: "Prior Name",
      affiliation: "ACME",
      surveyResponses: { q1: "a" },
      createdAt: { __fixed: "created" },
    });
  });

  it("promotes a waitlisted presenter who shows up — and survives a missing profile doc", async () => {
    rsvpSnap = snap({
      status: "waitlist",
      role: "presenter",
      displayName: "Wanda",
      email: "wanda@x",
      surveyResponses: {},
      createdAt: { __fixed: "created" },
    });
    // Guest-era accounts may have no users/{uid} doc — the check-in
    // must still land, just without the lifetime counter.
    userSnap = { exists: false, get: () => undefined };
    const res = await selfCheckIn("e1", "valid-token");
    expect(res.rsvp.status).toBe("confirmed");
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 1 },
      waitlistCount: { __inc: -1 },
      // Now-confirmed presenter enters the confirmed-presenter count.
      presenterCount: { __inc: 1 },
      attendanceCount: { __inc: 1 },
    });
    expect(updateTo("user")).toBeUndefined();
  });

  it("revalidates the localized event + attendee surfaces", async () => {
    await selfCheckIn("e1", "valid-token");
    // Every path is revalidated bare AND per locale (ja/en).
    for (const path of ["/events/jtpa-salon", "/my/rsvps", "/u/u1"]) {
      expect(revalidatePathMock).toHaveBeenCalledWith(path);
      expect(revalidatePathMock).toHaveBeenCalledWith(`/ja${path}`);
      expect(revalidatePathMock).toHaveBeenCalledWith(`/en${path}`);
    }
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/attendees");
  });
});

describe("setAttendance (admin manual toggle)", () => {
  it("is admin-gated", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(setAttendance("e1", "u2", true)).rejects.toThrow("FORBIDDEN");
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("throws RSVP_NOT_FOUND when the attendee row is gone", async () => {
    rsvpSnap = snap(null);
    await expect(setAttendance("e1", "u2", true)).rejects.toThrow(
      "RSVP_NOT_FOUND",
    );
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("no-ops when the desired state already holds", async () => {
    rsvpSnap = snap({
      status: "confirmed",
      role: "attendee",
      attendedAt: { __fixed: "earlier" },
    });
    await setAttendance("e1", "u2", true);
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("marks attendance: stamps attendedAt and bumps both counters", async () => {
    rsvpSnap = snap({ status: "confirmed", role: "attendee" });
    await setAttendance("e1", "u2", true);
    expect(updateTo("rsvp")).toMatchObject({
      attendedAt: { __fixed: "now" },
    });
    expect(updateTo("event")).toMatchObject({
      attendanceCount: { __inc: 1 },
    });
    expect(updateTo("user")).toMatchObject({ eventAttendanceCount: 4 });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/attendees");
    expect(revalidatePathMock).toHaveBeenCalledWith("/u/u2");
  });

  it("un-checks: deletes the marker and clamps the user counter at 0", async () => {
    rsvpSnap = snap({
      status: "confirmed",
      role: "attendee",
      attendedAt: { __fixed: "earlier" },
    });
    // Legacy doc whose lifetime counter is already 0 — the decrement
    // must clamp instead of going negative.
    userSnap = {
      exists: true,
      get: (field: string) =>
        ({ eventAttendanceCount: 0 } as Record<string, unknown>)[field],
    };
    await setAttendance("e1", "u2", false);
    expect(updateTo("rsvp")).toMatchObject({ attendedAt: "__delete__" });
    expect(updateTo("event")).toMatchObject({
      attendanceCount: { __inc: -1 },
    });
    expect(updateTo("user")).toMatchObject({ eventAttendanceCount: 0 });
  });

  it("never touches users/{uid} for legacy guest rows", async () => {
    // Guests have no account — there is no profile doc to count on.
    rsvpSnap = snap({ status: "confirmed", role: "attendee", isGuest: true });
    await setAttendance("e1", "u2", true);
    expect(txGetKinds()).not.toContain("user");
    expect(updateTo("user")).toBeUndefined();
    expect(updateTo("event")).toMatchObject({
      attendanceCount: { __inc: 1 },
    });
  });
});

describe("addAdminAttendee", () => {
  it("adds an existing site user as attended and bumps user lifetime attendance", async () => {
    const res = await addAdminAttendee({
      eventId: "e1",
      kind: "user",
      uid: "u2",
    });

    expect(getUserMock).toHaveBeenCalledWith("u2");
    expect(res).toMatchObject({
      ok: true,
      alreadyAttended: false,
      rsvp: {
        uid: "u2",
        displayName: "Bob",
        email: "bob@x",
        role: "attendee",
        status: "confirmed",
        attendedAt: { __fixed: "now" },
      },
    });
    expect(txSetMock).toHaveBeenCalledWith(rsvpRef, expect.anything());
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 1 },
      attendanceCount: { __inc: 1 },
    });
    expect(updateTo("user")).toMatchObject({ eventAttendanceCount: 4 });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/attendees");
    expect(revalidatePathMock).toHaveBeenCalledWith("/u/u2");
  });

  it("adds a guest attendee without touching users", async () => {
    const res = await addAdminAttendee({
      eventId: "e1",
      kind: "guest",
      displayName: "Guest Person",
      email: "GUEST@X",
      affiliation: "Visitor Org",
    });

    expect(getUserMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      ok: true,
      alreadyAttended: false,
      rsvp: {
        displayName: "Guest Person",
        email: "guest@x",
        affiliation: "Visitor Org",
        isGuest: true,
        status: "confirmed",
        attendedAt: { __fixed: "now" },
      },
    });
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 1 },
      attendanceCount: { __inc: 1 },
    });
    expect(updateTo("user")).toBeUndefined();
    expect(txGetKinds()).not.toContain("user");
  });

  it("does not double-count someone who is already attended", async () => {
    rsvpSnap = snap({
      uid: "u2",
      status: "confirmed",
      role: "attendee",
      displayName: "Prior Bob",
      email: "prior@x",
      surveyResponses: {},
      attendedAt: { __fixed: "earlier" },
      createdAt: { __fixed: "created" },
    });

    const res = await addAdminAttendee({
      eventId: "e1",
      kind: "user",
      uid: "u2",
    });

    expect(res).toMatchObject({
      ok: true,
      alreadyAttended: true,
      rsvp: {
        displayName: "Prior Bob",
        email: "prior@x",
        attendedAt: { __fixed: "earlier" },
      },
    });
    expect(updateTo("event")).toBeUndefined();
    expect(updateTo("user")).toBeUndefined();
  });
});
