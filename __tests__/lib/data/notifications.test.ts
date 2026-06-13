import { Timestamp } from "firebase-admin/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminDbMock } from "./_firestore-mock";

const mock = createAdminDbMock();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => mock.adminDb(),
}));

import {
  listMyNotifications,
  listUnreadNotifications,
} from "@/lib/data/notifications";

beforeEach(() => {
  mock.reset();
});

function notificationSnap(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    data: () => ({
      recipientUid: "u1",
      type: "comment",
      reason: "comment_on_content",
      actorUid: "actor",
      actorName: "Alice",
      actorPhotoURL: null,
      parentType: "post",
      parentId: "p1",
      parentTitle: "Hello",
      parentSlug: "hello",
      commentId: "c1",
      parentCommentId: null,
      commentPreview: "Nice",
      readAt: null,
      createdAt: new Timestamp(1, 0),
      ...overrides,
    }),
  };
}

describe("listMyNotifications", () => {
  it("filters by recipient and orders newest first", async () => {
    mock.setGet({ docs: [notificationSnap("n1")] });

    const out = await listMyNotifications("u1", 7);

    expect(mock.state.collection).toBe("notifications");
    expect(mock.state.whereCalls).toEqual([["recipientUid", "==", "u1"]]);
    expect(mock.state.orderByCalls).toEqual([["createdAt", "desc"]]);
    expect(mock.state.limit).toBe(7);
    expect(out[0]).toMatchObject({
      id: "n1",
      recipientUid: "u1",
      parentTitle: "Hello",
      readAt: null,
    });
  });
});

describe("listUnreadNotifications", () => {
  it("filters unread notifications for the recipient", async () => {
    mock.setGet({ docs: [notificationSnap("n1")] });

    await listUnreadNotifications("u1");

    expect(mock.state.collection).toBe("notifications");
    expect(mock.state.whereCalls).toEqual([
      ["recipientUid", "==", "u1"],
      ["readAt", "==", null],
    ]);
    expect(mock.state.limit).toBe(100);
  });
});
