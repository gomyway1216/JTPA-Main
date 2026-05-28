import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import { getGuideById, getGuideBySlug, listGuides } from "@/lib/data/guides";

function snap(id: string, data: object) {
  return { id, data: () => data };
}

beforeEach(() => {
  mock.reset();
});

describe("listGuides", () => {
  it("short-circuits to [] when statuses is empty (Firestore `in` rejects [])", async () => {
    // Without this guard a caller passing `[]` would crash at the
    // Firestore boundary; we'd rather return [] silently.
    const out = await listGuides({ statuses: [] });
    expect(out).toEqual([]);
    expect(mock.state.whereCalls).toEqual([]);
  });

  it("defaults to published, ordered by order asc then updatedAt desc, limit 100", async () => {
    await listGuides();
    expect(mock.state.collection).toBe("guides");
    expect(mock.state.whereCalls).toEqual([
      ["status", "in", ["published"]],
    ]);
    expect(mock.state.orderByCalls).toEqual([
      ["order", "asc"],
      ["updatedAt", "desc"],
    ]);
    expect(mock.state.limit).toBe(100);
  });

  it("respects custom statuses + limit", async () => {
    await listGuides({ statuses: ["draft"], limit: 3 });
    expect(mock.state.whereCalls).toEqual([["status", "in", ["draft"]]]);
    expect(mock.state.limit).toBe(3);
  });

  it("maps snapshots through fromSnap (id stamped on)", async () => {
    mock.setGet({
      docs: [
        snap("g1", { slug: "a", title: "A" }),
        snap("g2", { slug: "b", title: "B" }),
      ],
    });
    const result = await listGuides();
    expect(result).toEqual([
      { id: "g1", slug: "a", title: "A" },
      { id: "g2", slug: "b", title: "B" },
    ]);
  });
});

describe("getGuideById", () => {
  it("returns null when missing", async () => {
    mock.setGet({ exists: false });
    expect(await getGuideById("g1")).toBeNull();
  });

  it("returns the doc with id stamped on when found", async () => {
    mock.setGet({
      exists: true,
      id: "g1",
      data: () => ({ slug: "x", title: "X" }),
    });
    expect(await getGuideById("g1")).toEqual({
      id: "g1",
      slug: "x",
      title: "X",
    });
    expect(mock.state.docPath).toEqual({ collection: "guides", id: "g1" });
  });
});

describe("getGuideBySlug", () => {
  it("returns null when no doc matches", async () => {
    mock.setGet({ docs: [] });
    expect(await getGuideBySlug("missing")).toBeNull();
  });

  it("returns the first match", async () => {
    mock.setGet({ docs: [snap("g1", { slug: "x" })] });
    expect(await getGuideBySlug("x")).toEqual({ id: "g1", slug: "x" });
    expect(mock.state.whereCalls).toEqual([["slug", "==", "x"]]);
    expect(mock.state.limit).toBe(1);
  });
});
