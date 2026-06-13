import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import {
  getMyRsvp,
  listMyRsvpEventIds,
  listMyRsvps,
  listRsvps,
} from "@/lib/data/rsvps";

function snap(id: string, data: object) {
  return { id, data: () => data };
}

function snapWithParent(id: string, data: object, eventId: string) {
  // collectionGroup queries yield docs whose `.ref.parent.parent.id`
  // points back to the event; listMyRsvpEventIds depends on that
  // ancestry rather than denormalized event-id fields.
  return {
    id,
    data: () => data,
    ref: { parent: { parent: { id: eventId } } },
  };
}

beforeEach(() => {
  mock.reset();
});

describe("getMyRsvp", () => {
  it("returns null when the user has no RSVP for this event", async () => {
    mock.setGet({ exists: false });
    expect(await getMyRsvp("evt-1", "uid-1")).toBeNull();
  });

  it("returns the plainified rsvp data when present", async () => {
    mock.setGet({
      exists: true,
      id: "uid-1",
      data: () => ({ uid: "uid-1", status: "confirmed", role: "attendee" }),
    });
    const out = await getMyRsvp("evt-1", "uid-1");
    expect(out).toEqual({
      uid: "uid-1",
      status: "confirmed",
      role: "attendee",
    });
    // RSVPs key by uid, not auto-id.
    expect(mock.state.docPath).toEqual({
      collection: "events/evt-1/rsvps",
      id: "uid-1",
    });
  });
});

describe("listRsvps", () => {
  it("orders by createdAt asc (admin sees first-come-first-served)", async () => {
    await listRsvps("evt-1");
    expect(mock.state.collection).toBe("events/evt-1/rsvps");
    expect(mock.state.orderByCalls).toEqual([["createdAt", "asc"]]);
  });

  it("maps each rsvp into a plain object", async () => {
    mock.setGet({
      docs: [
        snap("uid-1", { uid: "uid-1", status: "confirmed" }),
        snap("uid-2", { uid: "uid-2", status: "waitlist" }),
      ],
    });
    expect(await listRsvps("evt-1")).toEqual([
      { uid: "uid-1", status: "confirmed" },
      { uid: "uid-2", status: "waitlist" },
    ]);
  });
});

describe("listMyRsvpEventIds", () => {
  it("uses a collectionGroup query filtered by uid, newest first", async () => {
    await listMyRsvpEventIds("uid-1");
    expect(mock.state.collectionGroup).toBe("rsvps");
    expect(mock.state.whereCalls).toEqual([["uid", "==", "uid-1"]]);
    expect(mock.state.orderByCalls).toEqual([["createdAt", "desc"]]);
  });

  it("extracts the parent event id from each doc's ref ancestry", async () => {
    mock.setGet({
      docs: [
        snapWithParent("uid-1", { uid: "uid-1" }, "evt-A"),
        snapWithParent("uid-1", { uid: "uid-1" }, "evt-B"),
      ],
    });
    expect(await listMyRsvpEventIds("uid-1")).toEqual(["evt-A", "evt-B"]);
  });

  it("skips docs whose ref ancestry is unexpectedly missing (defensive)", async () => {
    // Shouldn't happen in production — every rsvp lives under
    // /events/{id}/rsvps — but a malformed mock or test fixture
    // shouldn't crash production code paths.
    mock.setGet({
      docs: [
        snapWithParent("uid-1", { uid: "uid-1" }, "evt-A"),
        {
          id: "uid-1",
          data: () => ({ uid: "uid-1" }),
          ref: { parent: { parent: null } },
        },
      ],
    });
    expect(await listMyRsvpEventIds("uid-1")).toEqual(["evt-A"]);
  });
});

describe("listMyRsvps", () => {
  it("returns each RSVP with its parent event id", async () => {
    mock.setGet({
      docs: [
        snapWithParent(
          "uid-1",
          {
            uid: "uid-1",
            status: "confirmed",
            role: "attendee",
            surveyResponses: {},
          },
          "evt-A",
        ),
        snapWithParent(
          "uid-1",
          {
            uid: "uid-1",
            status: "cancelled",
            role: "presenter",
            surveyResponses: {},
          },
          "evt-B",
        ),
      ],
    });

    expect(await listMyRsvps("uid-1")).toEqual([
      {
        eventId: "evt-A",
        rsvp: {
          uid: "uid-1",
          status: "confirmed",
          role: "attendee",
          surveyResponses: {},
        },
      },
      {
        eventId: "evt-B",
        rsvp: {
          uid: "uid-1",
          status: "cancelled",
          role: "presenter",
          surveyResponses: {},
        },
      },
    ]);
  });
});
