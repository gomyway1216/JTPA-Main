import { beforeEach, describe, expect, it, vi } from "vitest";

// posts.ts is a thin wrapper over Firestore queries. We mock adminDb()
// to a chainable stub whose terminal `.get()` returns a snapshot, then
// assert each helper builds the right query (collection + where +
// orderBy + limit) and maps results through `fromSnap` (which adds `id`).

interface QueryCall {
  collection?: string;
  whereCalls: Array<[string, string, unknown]>;
  orderByCalls: Array<[string, string?]>;
  limit?: number;
  docPath?: { collection: string; id: string };
}

const lastCall: QueryCall = {
  whereCalls: [],
  orderByCalls: [],
};

function resetCall() {
  lastCall.collection = undefined;
  lastCall.whereCalls = [];
  lastCall.orderByCalls = [];
  lastCall.limit = undefined;
  lastCall.docPath = undefined;
}

type SnapStub =
  | { docs: Array<{ id: string; data: () => unknown }>; empty?: boolean }
  | { exists: boolean; id?: string; data?: () => unknown };

let getResult: SnapStub = { docs: [] };

function withEmpty(s: SnapStub): SnapStub {
  // Firestore's QuerySnapshot exposes `.empty` derived from docs.length;
  // mirror that here so callers that check `.empty` (e.g. getPostBySlug)
  // see the right value when we hand them `{ docs: [] }`.
  if ("docs" in s) {
    return { ...s, empty: s.docs.length === 0 };
  }
  return s;
}

function makeQuery() {
  const q = {
    where: vi.fn((f: string, op: string, val: unknown) => {
      lastCall.whereCalls.push([f, op, val]);
      return q;
    }),
    orderBy: vi.fn((f: string, dir?: string) => {
      lastCall.orderByCalls.push([f, dir]);
      return q;
    }),
    limit: vi.fn((n: number) => {
      lastCall.limit = n;
      return q;
    }),
    get: vi.fn(async () => withEmpty(getResult)),
  };
  return q;
}

function makeDoc(id: string) {
  return {
    get: vi.fn(async () => withEmpty(getResult)),
    id,
  };
}

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: (name: string) => {
      lastCall.collection = name;
      const q = makeQuery();
      return Object.assign(q, {
        doc: (id: string) => {
          lastCall.docPath = { collection: name, id };
          return makeDoc(id);
        },
      });
    },
  }),
}));

import {
  getPostById,
  getPostBySlug,
  listMyPosts,
  listPostsByStatus,
  listPublishedPosts,
  listPublishedPostsForLocale,
} from "@/lib/data/posts";

function snap(id: string, data: object) {
  return { id, data: () => data };
}

beforeEach(() => {
  resetCall();
  getResult = { docs: [] };
});

describe("listPublishedPosts", () => {
  it("filters status=='published' and orders by publishedAt desc", async () => {
    getResult = {
      docs: [snap("a", { slug: "a", title: "A" })],
    };
    const posts = await listPublishedPosts();
    expect(lastCall.collection).toBe("posts");
    expect(lastCall.whereCalls).toEqual([["status", "==", "published"]]);
    expect(lastCall.orderByCalls).toEqual([["publishedAt", "desc"]]);
    expect(lastCall.limit).toBe(50);
    expect(posts).toEqual([{ id: "a", slug: "a", title: "A" }]);
  });

  it("respects a custom limit", async () => {
    await listPublishedPosts(7);
    expect(lastCall.limit).toBe(7);
  });

  it("filters by locale while keeping legacy docs visible", async () => {
    getResult = {
      docs: [
        snap("ja", { slug: "ja", title: "JA", locales: ["ja"] }),
        snap("en", { slug: "en", title: "EN", locales: ["en"] }),
        snap("legacy", { slug: "legacy", title: "Legacy" }),
      ],
    };
    const posts = await listPublishedPostsForLocale("en", 2);
    expect(lastCall.whereCalls).toEqual([["status", "==", "published"]]);
    expect(lastCall.orderByCalls).toEqual([["publishedAt", "desc"]]);
    expect(lastCall.limit).toBe(100);
    expect(posts).toEqual([
      { id: "en", slug: "en", title: "EN", locales: ["en"] },
      { id: "legacy", slug: "legacy", title: "Legacy" },
    ]);
  });
});

describe("listPostsByStatus", () => {
  it("filters by the requested status and orders by updatedAt desc", async () => {
    await listPostsByStatus("pending");
    expect(lastCall.whereCalls).toEqual([["status", "==", "pending"]]);
    expect(lastCall.orderByCalls).toEqual([["updatedAt", "desc"]]);
    expect(lastCall.limit).toBe(100);
  });

  it("respects a custom limit", async () => {
    await listPostsByStatus("draft", 3);
    expect(lastCall.limit).toBe(3);
  });
});

describe("listMyPosts", () => {
  it("filters by authorUid (no status filter — authors see drafts too)", async () => {
    await listMyPosts("uid-1");
    // Authors can see their own draft / rejected / archived posts so
    // they understand why something disappeared from public view.
    expect(lastCall.whereCalls).toEqual([["authorUid", "==", "uid-1"]]);
    expect(lastCall.orderByCalls).toEqual([["updatedAt", "desc"]]);
    // No limit — full personal archive.
    expect(lastCall.limit).toBeUndefined();
  });
});

describe("getPostBySlug", () => {
  it("returns null when no doc matches the slug", async () => {
    getResult = { docs: [] };
    expect(await getPostBySlug("missing")).toBeNull();
  });

  it("returns the first match (slug is unique by convention)", async () => {
    getResult = {
      docs: [snap("p1", { slug: "x", title: "X" })],
    };
    const post = await getPostBySlug("x");
    expect(lastCall.whereCalls).toEqual([["slug", "==", "x"]]);
    expect(lastCall.limit).toBe(1);
    expect(post).toEqual({ id: "p1", slug: "x", title: "X" });
  });
});

describe("getPostById", () => {
  it("returns null when the doc doesn't exist", async () => {
    getResult = { exists: false };
    expect(await getPostById("p1")).toBeNull();
  });

  it("returns the data with id stamped on", async () => {
    getResult = {
      exists: true,
      id: "p1",
      data: () => ({ slug: "x", title: "X" }),
    };
    const post = await getPostById("p1");
    expect(lastCall.docPath).toEqual({ collection: "posts", id: "p1" });
    expect(post).toEqual({ id: "p1", slug: "x", title: "X" });
  });
});
