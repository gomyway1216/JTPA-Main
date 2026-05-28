import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import { listPresentations } from "@/lib/data/presentations";

function snap(id: string, data: object) {
  return { id, data: () => data };
}

beforeEach(() => {
  mock.reset();
});

describe("listPresentations", () => {
  it("reads from events/{eventId}/presentations ordered by createdAt asc", async () => {
    // Presentations are a per-event subcollection; nesting matters.
    // FIFO order so the admin run-of-show keeps registration order.
    await listPresentations("evt-1");
    expect(mock.state.collection).toBe("events/evt-1/presentations");
    expect(mock.state.orderByCalls).toEqual([["createdAt", "asc"]]);
  });

  it("maps each snapshot to a PresentationDoc with id stamped on", async () => {
    mock.setGet({
      docs: [
        snap("pr1", { title: "Talk 1", presenterUid: "u1" }),
        snap("pr2", { title: "Talk 2", presenterUid: "u2" }),
      ],
    });
    const out = await listPresentations("evt-1");
    expect(out).toEqual([
      { id: "pr1", title: "Talk 1", presenterUid: "u1" },
      { id: "pr2", title: "Talk 2", presenterUid: "u2" },
    ]);
  });

  it("returns [] when no presentations are registered", async () => {
    mock.setGet({ docs: [] });
    expect(await listPresentations("evt-1")).toEqual([]);
  });
});
