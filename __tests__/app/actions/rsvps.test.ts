import { beforeEach, describe, expect, it, vi } from "vitest";

// submitRsvp / cancelRsvp do all of their bucket arithmetic inside a
// Firestore transaction: which of rsvpCount / presenterCount /
// waitlistCount moves depends on the prior RSVP doc, the event's
// capacity, and the requested role. Mock `runTransaction` to run the
// callback against a hand-rolled `tx` whose `.get()` dispatches scripted
// snapshots by ref, and assert on the recorded `.set/.update` writes.
// (The pure delta arithmetic for cancellations lives in
// __tests__/lib/rsvp-counters.test.ts — here we test the wiring: which
// refs get which FieldValue.increment payloads.)

const requireUserMock = vi.fn();
const revalidatePathMock = vi.fn();
const enqueuePromotionMock = vi.fn();

const txGetMock = vi.fn();
const txSetMock = vi.fn();
const txUpdateMock = vi.fn();
const runTransactionMock = vi.fn(
  async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ get: txGetMock, set: txSetMock, update: txUpdateMock }),
);

// FIFO waitlist query recorders (cancelRsvp's promotion read).
const whereMock = vi.fn();
const orderByMock = vi.fn();
const limitMock = vi.fn();

// Refs are tagged with __kind so tx.get can dispatch the right snapshot
// and assertions can pick out the write aimed at a specific doc.
const rsvpRef = { __kind: "rsvp" };
const promoteeRef = { __kind: "promotee" };
const waitlistQuery: {
  __kind: string;
  orderBy: (...args: unknown[]) => unknown;
  limit: (...args: unknown[]) => unknown;
} = {
  __kind: "waitlistQuery",
  orderBy: (...args: unknown[]) => {
    orderByMock(...args);
    return waitlistQuery;
  },
  limit: (...args: unknown[]) => {
    limitMock(...args);
    return waitlistQuery;
  },
};
const eventRef = {
  __kind: "event",
  collection: (name: string) => {
    if (name !== "rsvps") throw new Error(`unexpected subcollection: ${name}`);
    return {
      doc: () => rsvpRef,
      where: (...args: unknown[]) => {
        whereMock(...args);
        return waitlistQuery;
      },
    };
  },
};

// Scripted per-test snapshots returned by tx.get, keyed by ref kind.
let eventSnap: { exists: boolean; data: () => unknown };
let rsvpSnap: { exists: boolean; data: () => unknown };
let waitlistSnap: { empty: boolean; docs: unknown[] };

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => ({ __fixed: "now" }) },
  // Sentinel so counter assertions can see the exact delta requested.
  FieldValue: { increment: (n: number) => ({ __inc: n }) },
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: (name: string) => {
      if (name !== "events") throw new Error(`unexpected collection: ${name}`);
      return { doc: () => eventRef };
    },
    runTransaction: (cb: (tx: unknown) => Promise<unknown>) =>
      runTransactionMock(cb),
  }),
}));

vi.mock("@/lib/notifications", () => ({
  enqueueWaitlistPromotionNotification: (...args: unknown[]) =>
    enqueuePromotionMock(...args),
}));

import { cancelRsvp, submitRsvp } from "@/app/actions/rsvps";

function snap(data: Record<string, unknown> | null) {
  return data
    ? { exists: true, data: () => data }
    : { exists: false, data: () => undefined };
}

function eventData(overrides: Record<string, unknown> = {}) {
  return {
    title: "JTPA Salon",
    slug: "jtpa-salon",
    status: "published",
    capacity: 10,
    presenterCapacity: 3,
    rsvpCount: 2,
    presenterCount: 1,
    waitlistCount: 0,
    ...overrides,
  };
}

function rsvpInput(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "e1",
    role: "attendee" as const,
    surveyResponses: { q1: "yes" },
    ...overrides,
  } as Parameters<typeof submitRsvp>[0];
}

// The write aimed at a particular tagged ref (undefined if none landed).
function updateTo(kind: string): Record<string, unknown> | undefined {
  const call = txUpdateMock.mock.calls.find(
    ([ref]) => (ref as { __kind?: string }).__kind === kind,
  );
  return call?.[1] as Record<string, unknown> | undefined;
}

async function expectError(
  p: Promise<{ ok: boolean; error?: string }>,
  substr: string,
) {
  const res = await p;
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("expected an error result, but got ok");
  expect(res.error).toContain(substr);
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
  revalidatePathMock.mockReset();
  enqueuePromotionMock.mockReset().mockResolvedValue(undefined);
  txSetMock.mockReset();
  txUpdateMock.mockReset();
  runTransactionMock.mockClear();
  whereMock.mockClear();
  orderByMock.mockClear();
  limitMock.mockClear();
  txGetMock
    .mockReset()
    .mockImplementation(async (target: { __kind?: string }) => {
      switch (target.__kind) {
        case "event":
          return eventSnap;
        case "rsvp":
          return rsvpSnap;
        case "waitlistQuery":
          return waitlistSnap;
        default:
          throw new Error("test bug: unexpected tx.get target");
      }
    });
  // Defaults: published event with seats free, no prior RSVP, nobody
  // waiting. Tests override the specific snapshot they care about.
  eventSnap = snap(eventData());
  rsvpSnap = snap(null);
  waitlistSnap = { empty: true, docs: [] };
});

describe("submitRsvp — auth + event guards", () => {
  it("rejects an unauthenticated caller before touching Firestore", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    await expect(submitRsvp(rsvpInput())).rejects.toThrow("UNAUTHENTICATED");
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  it("returns an error result (not a throw) when the event was deleted", async () => {
    // Thrown Server Action errors get masked as a generic digest in
    // production — the real reason must come back as { ok: false }.
    eventSnap = snap(null);
    await expectError(submitRsvp(rsvpInput()), "見つかりません");
    expect(txSetMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("refuses RSVPs on a cancelled event", async () => {
    eventSnap = snap(eventData({ status: "cancelled" }));
    await expectError(submitRsvp(rsvpInput()), "中止");
    expect(txSetMock).not.toHaveBeenCalled();
  });
});

describe("submitRsvp — fresh RSVP counter deltas", () => {
  it("confirms an attendee under capacity and bumps rsvpCount only", async () => {
    const res = await submitRsvp(rsvpInput());
    expect(res.ok).toBe(true);
    if (res.ok) {
      // plainify() must have run: the Client Component gets a plain
      // object with undefined optionals (attendedAt etc.) stripped.
      expect(res.rsvp).toMatchObject({
        uid: "u1",
        displayName: "Alice",
        email: "alice@x",
        role: "attendee",
        status: "confirmed",
        surveyResponses: { q1: "yes" },
      });
      expect(res.rsvp).not.toHaveProperty("attendedAt");
    }
    expect(txSetMock).toHaveBeenCalledWith(rsvpRef, expect.anything());
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 1 },
      presenterCount: { __inc: 0 },
      waitlistCount: { __inc: 0 },
    });
  });

  it("counts a confirmed presenter in presenterCount too", async () => {
    const res = await submitRsvp(rsvpInput({ role: "presenter" }));
    expect(res.ok).toBe(true);
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 1 },
      presenterCount: { __inc: 1 },
    });
  });

  it("waitlists a fresh RSVP at full capacity — without counting the presenter", async () => {
    // presenterCount tracks CONFIRMED presenters only; a presenter who
    // lands on the waitlist must not inflate it.
    eventSnap = snap(eventData({ capacity: 10, rsvpCount: 10 }));
    const res = await submitRsvp(rsvpInput({ role: "presenter" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rsvp.status).toBe("waitlist");
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 0 },
      presenterCount: { __inc: 0 },
      waitlistCount: { __inc: 1 },
    });
  });

  it("treats capacity=0 as unlimited (never waitlists)", async () => {
    eventSnap = snap(eventData({ capacity: 0, rsvpCount: 500 }));
    const res = await submitRsvp(rsvpInput());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rsvp.status).toBe("confirmed");
    expect(updateTo("event")).toMatchObject({ rsvpCount: { __inc: 1 } });
  });

  it("re-RSVPing after a cancellation counts as a fresh registration", async () => {
    // A cancelled prior already left the counters, so coming back must
    // re-enter the confirmed bucket (or waitlist, when full).
    rsvpSnap = snap({
      status: "cancelled",
      role: "attendee",
      createdAt: { __fixed: "created" },
    });
    const res = await submitRsvp(rsvpInput());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rsvp.status).toBe("confirmed");
    expect(updateTo("event")).toMatchObject({ rsvpCount: { __inc: 1 } });
  });

  it("a re-RSVP after cancellation gets a FRESH createdAt (no waitlist jump)", async () => {
    // Fairness regression: the waitlist is FIFO by `createdAt asc`. A user
    // who cancelled and re-registers is NOT an existing RSVP, so they must
    // get a brand-new `now` timestamp and go to the BACK of the queue —
    // reusing the old (earlier) createdAt would let them cut ahead of
    // everyone who signed up while they were gone. Land them on the
    // waitlist (full house) so the queue ordering actually matters.
    eventSnap = snap(eventData({ capacity: 10, rsvpCount: 10 }));
    rsvpSnap = snap({
      status: "cancelled",
      role: "attendee",
      createdAt: { __fixed: "created" },
    });
    const res = await submitRsvp(rsvpInput());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rsvp.status).toBe("waitlist");
    const [, doc] = txSetMock.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    // The persisted doc must carry the fresh `now`, NOT the stale prior
    // createdAt — this assertion fails against the pre-fix code, which used
    // `prior?.createdAt ?? now` and preserved { __fixed: "created" }.
    expect(doc.createdAt).toEqual({ __fixed: "now" });
    expect(doc.createdAt).not.toEqual({ __fixed: "created" });
  });
});

describe("submitRsvp — editing an existing RSVP", () => {
  it("an answers-only edit rewrites the doc but never touches counters", async () => {
    // Full house on purpose: an already-confirmed attendee editing
    // their survey answers must NOT be re-evaluated against capacity
    // and kicked to the waitlist.
    eventSnap = snap(eventData({ capacity: 10, rsvpCount: 10 }));
    rsvpSnap = snap({
      status: "confirmed",
      role: "attendee",
      createdAt: { __fixed: "created" },
    });
    const res = await submitRsvp(
      rsvpInput({ surveyResponses: { q1: "changed" } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.rsvp.status).toBe("confirmed");
    expect(txSetMock).toHaveBeenCalledTimes(1);
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("attendee → presenter switch bumps presenterCount only", async () => {
    rsvpSnap = snap({ status: "confirmed", role: "attendee" });
    await submitRsvp(rsvpInput({ role: "presenter" }));
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 0 },
      presenterCount: { __inc: 1 },
      waitlistCount: { __inc: 0 },
    });
  });

  it("presenter → attendee switch releases the presenter slot", async () => {
    rsvpSnap = snap({ status: "confirmed", role: "presenter" });
    await submitRsvp(rsvpInput({ role: "attendee" }));
    expect(updateTo("event")).toMatchObject({
      presenterCount: { __inc: -1 },
    });
  });

  it("a waitlisted edit STAYS waitlist and never touches counters", async () => {
    // Regression for the counter-desync bug: a waitlisted user editing
    // their RSVP (e.g. affiliation / survey answers) must remain on the
    // waitlist. Re-evaluating capacity here used to silently promote them
    // to "confirmed" past capacity while leaving rsvpCount too low and
    // waitlistCount too high — a permanent desync. Promotion happens only
    // via the cancel→promote flow, never by editing.
    eventSnap = snap(
      eventData({ capacity: 10, rsvpCount: 10, waitlistCount: 1 }),
    );
    rsvpSnap = snap({
      status: "waitlist",
      role: "attendee",
      affiliation: "Old Co",
      createdAt: { __fixed: "created" },
    });
    const res = await submitRsvp(
      rsvpInput({ affiliation: "New Co", surveyResponses: { q1: "changed" } }),
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rsvp.status).toBe("waitlist");
      expect(res.rsvp.affiliation).toBe("New Co");
    }
    // Doc is rewritten, but no counter movement at all (no rsvpCount++ /
    // waitlistCount--), so the event update is skipped entirely.
    expect(txSetMock).toHaveBeenCalledTimes(1);
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("a waitlisted attendee → presenter switch STAYS waitlist with no presenterCount change", async () => {
    // presenterCount tracks CONFIRMED presenters only. A waitlisted RSVP
    // never contributed to it, so switching role while waitlisted must
    // leave presenterCount (and every other counter) untouched.
    eventSnap = snap(
      eventData({ capacity: 10, rsvpCount: 10, waitlistCount: 1 }),
    );
    rsvpSnap = snap({
      status: "waitlist",
      role: "attendee",
      createdAt: { __fixed: "created" },
    });
    const res = await submitRsvp(rsvpInput({ role: "presenter" }));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.rsvp.status).toBe("waitlist");
      expect(res.rsvp.role).toBe("presenter");
    }
    expect(txSetMock).toHaveBeenCalledTimes(1);
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("preserves check-in markers + createdAt across edits", async () => {
    // tx.set() overwrites the whole doc — without forwarding these the
    // attendee would look un-checked-in after editing their answers.
    rsvpSnap = snap({
      status: "confirmed",
      role: "attendee",
      attendedAt: { __fixed: "earlier" },
      isGuest: true,
      createdAt: { __fixed: "created" },
    });
    await submitRsvp(rsvpInput());
    const [, doc] = txSetMock.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(doc.attendedAt).toEqual({ __fixed: "earlier" });
    expect(doc.isGuest).toBe(true);
    expect(doc.createdAt).toEqual({ __fixed: "created" });
    expect(doc.updatedAt).toEqual({ __fixed: "now" });
  });

  it("revalidates the events list + my-RSVPs page on success", async () => {
    await submitRsvp(rsvpInput());
    expect(revalidatePathMock).toHaveBeenCalledWith("/events");
    expect(revalidatePathMock).toHaveBeenCalledWith("/my/rsvps");
  });
});

describe("cancelRsvp — idempotency + guards", () => {
  it("succeeds without writing when there is no RSVP doc", async () => {
    rsvpSnap = snap(null);
    await expect(cancelRsvp({ eventId: "e1" })).resolves.toEqual({ ok: true });
    expect(txUpdateMock).not.toHaveBeenCalled();
    expect(enqueuePromotionMock).not.toHaveBeenCalled();
  });

  it("succeeds without writing when the RSVP is already cancelled", async () => {
    rsvpSnap = snap({ status: "cancelled", role: "attendee" });
    await expect(cancelRsvp({ eventId: "e1" })).resolves.toEqual({ ok: true });
    expect(txUpdateMock).not.toHaveBeenCalled();
  });

  it("surfaces an event deleted mid-cancel as an error result", async () => {
    rsvpSnap = snap({ status: "confirmed", role: "attendee" });
    eventSnap = snap(null);
    await expectError(cancelRsvp({ eventId: "e1" }), "見つかりません");
    expect(txUpdateMock).not.toHaveBeenCalled();
    expect(enqueuePromotionMock).not.toHaveBeenCalled();
  });
});

describe("cancelRsvp — counter deltas + waitlist promotion", () => {
  it("confirmed attendee with an empty waitlist: rsvp −1, status flipped", async () => {
    rsvpSnap = snap({ status: "confirmed", role: "attendee" });
    const res = await cancelRsvp({ eventId: "e1" });
    expect(res.ok).toBe(true);
    expect(updateTo("rsvp")).toMatchObject({ status: "cancelled" });
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: -1 },
      presenterCount: { __inc: 0 },
      waitlistCount: { __inc: 0 },
    });
    // The promotion query ran (a confirmed seat opened) but found
    // nobody — no promotee write, no mail.
    expect(whereMock).toHaveBeenCalledWith("status", "==", "waitlist");
    expect(updateTo("promotee")).toBeUndefined();
    expect(enqueuePromotionMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).toHaveBeenCalledWith("/events/[slug]", "page");
  });

  it("promotes the oldest waitlister FIFO and enqueues their notification", async () => {
    rsvpSnap = snap({ status: "confirmed", role: "attendee" });
    waitlistSnap = {
      empty: false,
      docs: [
        {
          ref: promoteeRef,
          data: () => ({
            email: "waiting@x",
            displayName: "Waiting Wanda",
            role: "presenter",
          }),
        },
      ],
    };
    const res = await cancelRsvp({ eventId: "e1" });
    expect(res.ok).toBe(true);
    // FIFO = oldest createdAt first, exactly one.
    expect(orderByMock).toHaveBeenCalledWith("createdAt", "asc");
    expect(limitMock).toHaveBeenCalledWith(1);
    expect(updateTo("promotee")).toMatchObject({ status: "confirmed" });
    // Net: confirmed −1 +1 = 0; the promotee leaves the waitlist; a
    // presenter promotee re-enters the confirmed-presenter count.
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 0 },
      waitlistCount: { __inc: -1 },
      presenterCount: { __inc: 1 },
    });
    // Mail goes out once, after commit, with the event's canonical
    // title/slug (not caller-supplied data).
    expect(enqueuePromotionMock).toHaveBeenCalledTimes(1);
    expect(enqueuePromotionMock).toHaveBeenCalledWith({
      to: "waiting@x",
      displayName: "Waiting Wanda",
      eventTitle: "JTPA Salon",
      eventSlug: "jtpa-salon",
      role: "presenter",
    });
  });

  it("a waitlist cancel frees no seat: waitlist −1 and no promotion query", async () => {
    rsvpSnap = snap({ status: "waitlist", role: "attendee" });
    const res = await cancelRsvp({ eventId: "e1" });
    expect(res.ok).toBe(true);
    expect(whereMock).not.toHaveBeenCalled();
    expect(updateTo("event")).toMatchObject({
      rsvpCount: { __inc: 0 },
      waitlistCount: { __inc: -1 },
      presenterCount: { __inc: 0 },
    });
    expect(enqueuePromotionMock).not.toHaveBeenCalled();
  });
});
