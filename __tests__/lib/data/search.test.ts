import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminDbMock } from "./_firestore-mock";

const cacheOptions = vi.hoisted(() => [] as { tags: string[]; revalidate: number }[]);
vi.mock("next/cache", () => ({
  unstable_cache: (fn: unknown, _keys: string[], options: typeof cacheOptions[number]) => {
    cacheOptions.push(options);
    return fn;
  },
}));
const mock = createAdminDbMock();
vi.mock("@/lib/firebase/admin", () => ({ adminDb: () => mock.adminDb() }));
import { getSearchDocuments } from "@/lib/data/search";

beforeEach(() => mock.reset());

describe("search corpus loading", () => {
  it("queries public statuses without a listing cap or date requirement", async () => {
    await getSearchDocuments("ja");
    expect(mock.state.whereCalls).toEqual([
      ["status", "==", "published"], ["status", "==", "published"],
      ["status", "==", "approved"], ["status", "in", ["published", "past"]],
    ]);
    expect(mock.state.limit).toBeUndefined();
    expect(mock.state.orderByCalls).toEqual([]);
    expect(cacheOptions).toContainEqual({ tags: ["posts", "guides", "projects", "events"], revalidate: 60 });
  });

  it("does not expose member-only events or private fields, even when returned by a query", async () => {
    const snap = (data: unknown) => ({ docs: [{ id: "1", data: () => data }] });
    mock.setGetQueue([
      snap({ slug: "one", title: "記事", body: "本文", excerpt: "要約", status: "published", reviewerUid: "secret-reviewer" }),
      { docs: [] }, { docs: [] },
      snap({ slug: "private", title: "会員限定", description: "private event", status: "published", visibility: "members_only", checkInToken: "secret-token" }),
    ]);
    const docs = await getSearchDocuments("ja");
    expect(docs).toHaveLength(1);
    expect(docs[0].href).toBe("/blog/one");
    expect(JSON.stringify(docs)).not.toContain("secret");
  });

  it("surfaces query failures instead of falsely reporting no matches", async () => {
    mock.setGetQueue([new Error("unavailable")]);
    await expect(getSearchDocuments("ja")).rejects.toThrow("unavailable");
  });
});
