import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import { getQaById, getQaBySlug, listMyQa, listQa } from "@/lib/data/qa";

function snap(id: string, data: object) {
  return { id, data: () => data };
}

beforeEach(() => {
  mock.reset();
});

describe("listQa", () => {
  it("short-circuits to [] when statuses is empty", async () => {
    expect(await listQa({ statuses: [] })).toEqual([]);
    expect(mock.state.whereCalls).toEqual([]);
  });

  it("defaults to published, ordered by createdAt desc, limit 50", async () => {
    await listQa();
    expect(mock.state.collection).toBe("qa");
    expect(mock.state.whereCalls).toEqual([
      ["status", "in", ["published"]],
    ]);
    expect(mock.state.orderByCalls).toEqual([["createdAt", "desc"]]);
    expect(mock.state.limit).toBe(50);
  });

  it("defaults likeCount to 0 on docs that pre-date the field", async () => {
    // Older Q&A docs were written before likeCount existed; the fromSnap
    // helper backfills 0 so the typed shape always matches the runtime.
    mock.setGet({
      docs: [snap("q1", { slug: "a", title: "A" })],
    });
    const result = await listQa();
    expect(result[0]).toEqual({ id: "q1", slug: "a", title: "A", likeCount: 0 });
  });

  it("doesn't clobber an explicit likeCount on newer docs", async () => {
    mock.setGet({
      docs: [snap("q1", { slug: "a", title: "A", likeCount: 7 })],
    });
    const result = await listQa();
    expect(result[0].likeCount).toBe(7);
  });
});

describe("listMyQa", () => {
  it("filters by authorUid with no status filter (author sees archived too)", async () => {
    // Same pattern as listMyPosts/listMyProjects: authors get to see why
    // their post disappeared.
    await listMyQa("uid-1");
    expect(mock.state.whereCalls).toEqual([["authorUid", "==", "uid-1"]]);
    expect(mock.state.orderByCalls).toEqual([["updatedAt", "desc"]]);
    expect(mock.state.limit).toBe(100);
  });
});

describe("getQaById", () => {
  it("returns null when missing", async () => {
    mock.setGet({ exists: false });
    expect(await getQaById("q1")).toBeNull();
  });

  it("returns the doc with likeCount defaulted to 0", async () => {
    mock.setGet({
      exists: true,
      id: "q1",
      data: () => ({ slug: "x", title: "X" }),
    });
    expect(await getQaById("q1")).toEqual({
      id: "q1",
      slug: "x",
      title: "X",
      likeCount: 0,
    });
  });
});

describe("getQaBySlug", () => {
  it("returns null when missing", async () => {
    mock.setGet({ docs: [] });
    expect(await getQaBySlug("missing")).toBeNull();
  });

  it("returns the first match (fromSnap defaults likeCount)", async () => {
    mock.setGet({ docs: [snap("q1", { slug: "x" })] });
    expect(await getQaBySlug("x")).toEqual({
      id: "q1",
      slug: "x",
      likeCount: 0,
    });
  });
});
