import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import { listLikedRecordsByAuthor } from "@/lib/data/received-likes";

function snap(id: string, data: object) {
  return { id, data: () => data };
}

beforeEach(() => {
  mock.reset();
});

describe("listLikedRecordsByAuthor", () => {
  it("queries every content collection for authored records with likes", async () => {
    mock.setGetQueue([
      {
        docs: [
          snap("p1", {
            title: "Post",
            slug: "post",
            likeCount: 2,
            updatedAt: new Timestamp(10, 0),
          }),
        ],
      },
      {
        docs: [
          snap("g1", {
            title: "Guide",
            slug: "guide",
            likeCount: 5,
            updatedAt: new Timestamp(20, 0),
          }),
        ],
      },
      {
        docs: [
          snap("q1", {
            title: "Question",
            slug: "question",
            likeCount: 1,
            updatedAt: new Timestamp(30, 0),
          }),
        ],
      },
      {
        docs: [
          snap("s1", {
            title: "Project",
            slug: "project",
            likeCount: 4,
            updatedAt: new Timestamp(40, 0),
          }),
        ],
      },
      { docs: [] },
    ]);

    const records = await listLikedRecordsByAuthor("uid-1");

    expect(records.map((item) => `${item.parentType}:${item.parentId}`)).toEqual(
      ["guide:g1", "project:s1", "post:p1", "qa:q1"],
    );
    expect(mock.state.whereCalls).toEqual([
      ["authorUid", "==", "uid-1"],
      ["likeCount", ">", 0],
      ["authorUid", "==", "uid-1"],
      ["likeCount", ">", 0],
      ["authorUid", "==", "uid-1"],
      ["likeCount", ">", 0],
      ["ownerUid", "==", "uid-1"],
      ["likeCount", ">", 0],
      ["authorUid", "==", "uid-1"],
      ["likeCount", ">", 0],
    ]);
    expect(mock.state.orderByCalls).toEqual([
      ["likeCount", "desc"],
      ["likeCount", "desc"],
      ["likeCount", "desc"],
      ["likeCount", "desc"],
      ["likeCount", "desc"],
    ]);
    expect(mock.state.limit).toBe(50);
  });

  it("skips malformed or unliked records defensively", async () => {
    mock.setGetQueue([
      {
        docs: [
          snap("missing-title", { slug: "missing-title", likeCount: 3 }),
          snap("missing-slug", { title: "Missing slug", likeCount: 3 }),
          snap("zero", { title: "Zero", slug: "zero", likeCount: 0 }),
          snap("valid", { title: "Valid", slug: "valid", likeCount: 1 }),
        ],
      },
      { docs: [] },
      { docs: [] },
      { docs: [] },
      { docs: [] },
    ]);

    const records = await listLikedRecordsByAuthor("uid-1");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      parentType: "post",
      parentId: "valid",
      title: "Valid",
      slug: "valid",
      likeCount: 1,
    });
  });
});
