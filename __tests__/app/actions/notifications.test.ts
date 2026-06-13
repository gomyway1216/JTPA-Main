import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUserMock = vi.fn();
const collectionMock = vi.fn();
const whereMock = vi.fn();
const limitMock = vi.fn();
const getMock = vi.fn();
const updateMock = vi.fn();
const commitMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: { now: () => "__now__" },
}));

vi.mock("@/lib/firebase/admin", () => {
  function query() {
    return {
      where: (field: string, op: string, value: unknown) => {
        whereMock(field, op, value);
        return query();
      },
      limit: (limit: number) => {
        limitMock(limit);
        return query();
      },
      get: () => getMock(),
    };
  }

  return {
    adminDb: () => ({
      collection: (name: string) => {
        collectionMock(name);
        return query();
      },
      batch: () => ({
        update: (...args: unknown[]) => updateMock(...args),
        commit: () => commitMock(),
      }),
    }),
  };
});

import { markAllNotificationsRead } from "@/app/actions/notifications";

function snap(ids: string[]) {
  return {
    empty: ids.length === 0,
    docs: ids.map((id) => ({ id, ref: { path: `notifications/${id}` } })),
  };
}

beforeEach(() => {
  requireUserMock.mockReset().mockResolvedValue({ uid: "u1" });
  collectionMock.mockReset();
  whereMock.mockReset();
  limitMock.mockReset();
  getMock.mockReset();
  updateMock.mockReset();
  commitMock.mockReset().mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
});

describe("markAllNotificationsRead", () => {
  it("marks every unread notification by looping through batches", async () => {
    getMock
      .mockResolvedValueOnce(snap(["n1", "n2"]))
      .mockResolvedValueOnce(snap(["n3"]))
      .mockResolvedValueOnce(snap([]));

    await markAllNotificationsRead();

    expect(collectionMock).toHaveBeenCalledWith("notifications");
    expect(whereMock).toHaveBeenCalledWith("recipientUid", "==", "u1");
    expect(whereMock).toHaveBeenCalledWith("readAt", "==", null);
    expect(limitMock).toHaveBeenCalledWith(500);
    expect(updateMock).toHaveBeenCalledTimes(3);
    expect(updateMock.mock.calls.map((call) => call[1])).toEqual([
      { readAt: "__now__" },
      { readAt: "__now__" },
      { readAt: "__now__" },
    ]);
    expect(commitMock).toHaveBeenCalledTimes(2);
    expect(revalidatePathMock).toHaveBeenCalledWith("/my");
    expect(revalidatePathMock).toHaveBeenCalledWith("/my/notifications");
  });

  it("skips writes and revalidation when nothing is unread", async () => {
    getMock.mockResolvedValueOnce(snap([]));

    await markAllNotificationsRead();

    expect(updateMock).not.toHaveBeenCalled();
    expect(commitMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
