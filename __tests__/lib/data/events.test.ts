import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

// The factory itself runs at module-load time (when `mock` may still be
// in temporal dead zone for top-level imports of the data module), so
// we wrap the export in a thunk that defers reading `mock.adminDb`
// until a test actually calls adminDb() — by which point the const
// above has been initialized.
vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

// `firebase-admin/firestore` exports `Timestamp.now()` — events.ts uses
// it to filter by `endAt`. Stub it so the query payload is comparable
// across runs.
vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: () => ({ __fixed: "now" }),
  },
}));

import {
  getEventById,
  getEventBySlug,
  listEvents,
  listPastEvents,
} from "@/lib/data/events";

function snap(id: string, data: object) {
  return { id, data: () => data };
}

beforeEach(() => {
  mock.reset();
});

describe("listEvents", () => {
  it("defaults to published events ordered by startAt asc, limit 20", async () => {
    await listEvents();
    expect(mock.state.collection).toBe("events");
    expect(mock.state.whereCalls).toEqual([
      ["status", "in", ["published"]],
    ]);
    expect(mock.state.orderByCalls).toEqual([["startAt", "asc"]]);
    expect(mock.state.limit).toBe(20);
  });

  it("switches to endAt ordering when notEndedOnly is true", async () => {
    // The endAt-based path is the one that keeps in-progress events
    // surfacing on /events even when admin hasn't flipped status to
    // 'past' yet. Pin the where + orderBy choice.
    await listEvents({ notEndedOnly: true });
    expect(mock.state.whereCalls).toEqual([
      ["status", "in", ["published"]],
      ["endAt", ">=", { __fixed: "now" }],
    ]);
    expect(mock.state.orderByCalls).toEqual([["endAt", "asc"]]);
  });

  it("accepts a custom status list and limit", async () => {
    await listEvents({ statuses: ["draft", "published"], limit: 5 });
    expect(mock.state.whereCalls[0]).toEqual([
      "status",
      "in",
      ["draft", "published"],
    ]);
    expect(mock.state.limit).toBe(5);
  });

  it("maps each snapshot through fromSnap (id is stamped on)", async () => {
    mock.setGet({
      docs: [
        snap("e1", { slug: "a", title: "A" }),
        snap("e2", { slug: "b", title: "B" }),
      ],
    });
    const result = await listEvents();
    expect(result).toEqual([
      { id: "e1", slug: "a", title: "A" },
      { id: "e2", slug: "b", title: "B" },
    ]);
  });
});

describe("listPastEvents", () => {
  it("includes both 'past' and 'published' (auto-rolled events with endAt < now)", async () => {
    // Issue #20: don't wait for admin to manually flip status — show
    // any published event whose endAt has slipped into the past.
    await listPastEvents();
    expect(mock.state.whereCalls).toEqual([
      ["status", "in", ["past", "published"]],
      ["endAt", "<", { __fixed: "now" }],
    ]);
    expect(mock.state.orderByCalls).toEqual([["endAt", "desc"]]);
    expect(mock.state.limit).toBe(20);
  });

  it("respects a custom limit", async () => {
    await listPastEvents(7);
    expect(mock.state.limit).toBe(7);
  });
});

describe("getEventBySlug", () => {
  it("returns null when no event matches the slug", async () => {
    mock.setGet({ docs: [] });
    expect(await getEventBySlug("missing")).toBeNull();
  });

  it("returns the first match when found", async () => {
    mock.setGet({
      docs: [snap("e1", { slug: "x", title: "X" })],
    });
    const e = await getEventBySlug("x");
    expect(mock.state.whereCalls).toEqual([["slug", "==", "x"]]);
    expect(mock.state.limit).toBe(1);
    expect(e).toEqual({ id: "e1", slug: "x", title: "X" });
  });
});

describe("getEventById", () => {
  it("returns null when the doc doesn't exist", async () => {
    mock.setGet({ exists: false });
    expect(await getEventById("e1")).toBeNull();
  });

  it("returns the data with id stamped on", async () => {
    mock.setGet({
      exists: true,
      id: "e1",
      data: () => ({ slug: "x", title: "X" }),
    });
    const e = await getEventById("e1");
    expect(mock.state.docPath).toEqual({ collection: "events", id: "e1" });
    expect(e).toEqual({ id: "e1", slug: "x", title: "X" });
  });
});
