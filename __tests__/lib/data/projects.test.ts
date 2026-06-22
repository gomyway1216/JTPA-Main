import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import {
  getProjectById,
  getProjectBySlug,
  listMyProjects,
  listProjects,
} from "@/lib/data/projects";

function snap(id: string, data: object) {
  return { id, data: () => data };
}

beforeEach(() => {
  mock.reset();
});

describe("listProjects", () => {
  it("defaults to approved, ordered by submittedAt desc, limit 50", async () => {
    // Showcase listing must NEVER default to anything but `approved` —
    // pending / rejected docs are author-visible only.
    await listProjects();
    expect(mock.state.collection).toBe("projects");
    expect(mock.state.whereCalls).toEqual([["status", "==", "approved"]]);
    expect(mock.state.orderByCalls).toEqual([["submittedAt", "desc"]]);
    expect(mock.state.limit).toBe(50);
  });

  it("accepts a custom status + limit", async () => {
    await listProjects({ status: "pending", limit: 10 });
    expect(mock.state.whereCalls).toEqual([["status", "==", "pending"]]);
    expect(mock.state.limit).toBe(10);
  });

  it("maps each snapshot with id stamped on", async () => {
    mock.setGet({
      docs: [
        snap("p1", { slug: "a", title: "A" }),
        snap("p2", { slug: "b", title: "B" }),
      ],
    });
    const out = await listProjects();
    expect(out).toEqual([
      { id: "p1", slug: "a", title: "A" },
      { id: "p2", slug: "b", title: "B" },
    ]);
  });

  it("keeps locale-specific callers on the full approved list", async () => {
    mock.setGet({
      docs: [
        snap("p-en", { slug: "en", title: "EN", locales: ["en"] }),
      ],
    });
    const out = await listProjects({ locale: "en", limit: 2 });
    expect(mock.state.whereCalls).toEqual([
      ["status", "==", "approved"],
    ]);
    expect(mock.state.orderByCalls).toEqual([["submittedAt", "desc"]]);
    expect(mock.state.limit).toBe(2);
    expect(out).toEqual([{ id: "p-en", slug: "en", title: "EN", locales: ["en"] }]);
  });
});

describe("listMyProjects", () => {
  it("filters by ownerUid (no status filter — show user's own pending/rejected too)", async () => {
    await listMyProjects("uid-1");
    expect(mock.state.whereCalls).toEqual([["ownerUid", "==", "uid-1"]]);
    expect(mock.state.orderByCalls).toEqual([["updatedAt", "desc"]]);
  });
});

describe("getProjectBySlug", () => {
  it("returns null when no doc matches", async () => {
    mock.setGet({ docs: [] });
    expect(await getProjectBySlug("missing")).toBeNull();
  });

  it("returns the first match when found", async () => {
    mock.setGet({ docs: [snap("p1", { slug: "x" })] });
    expect(await getProjectBySlug("x")).toEqual({ id: "p1", slug: "x" });
    expect(mock.state.whereCalls).toEqual([["slug", "==", "x"]]);
    expect(mock.state.limit).toBe(1);
  });
});

describe("getProjectById", () => {
  it("returns null when missing", async () => {
    mock.setGet({ exists: false });
    expect(await getProjectById("p1")).toBeNull();
  });

  it("returns the doc with id stamped on", async () => {
    mock.setGet({
      exists: true,
      id: "p1",
      data: () => ({ slug: "x" }),
    });
    expect(await getProjectById("p1")).toEqual({ id: "p1", slug: "x" });
  });
});
