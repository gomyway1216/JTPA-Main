import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import { listFeedback } from "@/lib/data/feedback";
import { decodePageCursor, encodePageCursor } from "@/lib/data/page-cursor";

beforeEach(() => {
  mock.reset();
});

function feedbackSnap(id: string, seconds: number) {
  return {
    id,
    data: () => ({
      body: `feedback ${id}`,
      authorUid: `u-${id}`,
      authorEmail: null,
      authorDisplayName: null,
      authorUsername: null,
      status: "new",
      createdAt: new Timestamp(seconds, 0),
    }),
  };
}

describe("listFeedback — cursor pagination", () => {
  it("short-circuits an empty statuses filter without touching Firestore", async () => {
    const page = await listFeedback({ statuses: [] });
    expect(page).toEqual({ entries: [], nextCursor: null });
    expect(mock.state.collection).toBeUndefined();
  });

  it("filters by status and pages newest-first with a doc-id tiebreak", async () => {
    mock.setGet({ docs: [feedbackSnap("f1", 9)] });
    await listFeedback({ statuses: ["new", "read"], pageSize: 10 });

    expect(mock.state.collection).toBe("feedback");
    expect(mock.state.whereCalls).toEqual([["status", "in", ["new", "read"]]]);
    // (createdAt desc, doc id desc): the explicit __name__ tiebreak
    // matches the implicit ordering of the existing (status, createdAt
    // desc) composite index, so no new index entry is required.
    expect(mock.state.orderByCalls).toEqual([
      ["createdAt", "desc"],
      [FieldPath.documentId(), "desc"],
    ]);
    // Overfetch by one to detect whether another page exists.
    expect(mock.state.limit).toBe(11);
    expect(mock.state.startAfter).toBeUndefined();
  });

  it("returns nextCursor=null when the backlog fits in one page", async () => {
    mock.setGet({ docs: [feedbackSnap("f1", 9), feedbackSnap("f2", 8)] });
    const page = await listFeedback({ pageSize: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("drops the overfetched doc and emits a cursor for the last returned one", async () => {
    mock.setGet({
      docs: [feedbackSnap("f1", 9), feedbackSnap("f2", 8), feedbackSnap("f3", 7)],
    });
    const page = await listFeedback({ pageSize: 2 });
    expect(page.entries.map((e) => e.id)).toEqual(["f1", "f2"]);
    const decoded = decodePageCursor(page.nextCursor!);
    expect(decoded).toMatchObject({ id: "f2" });
    expect(decoded!.createdAt.seconds).toBe(8);
  });

  it("resumes after the decoded cursor position", async () => {
    mock.setGet({ docs: [feedbackSnap("f3", 7)] });
    const cursor = encodePageCursor(new Timestamp(8, 0), "f2")!;
    const page = await listFeedback({ pageSize: 2, cursor });
    expect(mock.state.startAfter).toEqual([new Timestamp(8, 0), "f2"]);
    expect(page.entries.map((e) => e.id)).toEqual(["f3"]);
  });

  it("treats a malformed ?cursor= value as the first page instead of throwing", async () => {
    // The admin page feeds this straight from the URL — hand-edited
    // values must degrade gracefully.
    mock.setGet({ docs: [feedbackSnap("f1", 9)] });
    const page = await listFeedback({ cursor: "not-a-cursor" });
    expect(mock.state.startAfter).toBeUndefined();
    expect(page.entries).toHaveLength(1);
  });

  it("defaults the reviewer fields to null on legacy docs", async () => {
    // Older docs predate the reviewer columns; the type promises
    // null-or-value, never undefined.
    mock.setGet({ docs: [feedbackSnap("f1", 9)] });
    const page = await listFeedback();
    expect(page.entries[0]).toMatchObject({
      reviewerUid: null,
      reviewerDisplayName: null,
      reviewedAt: null,
    });
  });
});
