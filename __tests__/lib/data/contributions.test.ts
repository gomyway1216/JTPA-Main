import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `getPublicContributionCounts` fans out five parallel `count()`
// aggregations, one per public-content collection. The shared
// `_firestore-mock` only tracks the LAST query's shape (single `state`),
// which can't verify five distinct concurrent queries — so this file uses
// a purpose-built mock that records EVERY query (collection + where
// chain) and lets each test stub per-collection counts (or force a
// per-collection failure to prove the degrade-to-0 path).

interface RecordedQuery {
  collection: string;
  whereCalls: Array<[string, string, unknown]>;
}

const recorded: RecordedQuery[] = [];
// Per-collection count to return from the aggregation. Missing entry ⇒ 0.
let counts: Record<string, number> = {};
// Collections whose aggregation should reject (simulates an unsupported
// aggregation / transient Firestore error).
let throwFor = new Set<string>();

function makeQuery(collection: string) {
  const q = {
    collection,
    whereCalls: [] as Array<[string, string, unknown]>,
    where(field: string, op: string, value: unknown) {
      this.whereCalls.push([field, op, value]);
      return this;
    },
    count() {
      return {
        get: async () => {
          if (throwFor.has(collection)) {
            throw new Error(`aggregation unsupported for ${collection}`);
          }
          return { data: () => ({ count: counts[collection] ?? 0 }) };
        },
      };
    },
  };
  return q;
}

const adminDb = () => ({
  collection: (name: string) => {
    const q = makeQuery(name);
    recorded.push(q);
    return q;
  },
});

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => adminDb(),
}));

import { getPublicContributionCounts } from "@/lib/data/contributions";

// Silence the expected console.warn from the degrade-to-0 path so a
// passing run stays quiet. Scoped to this file's hooks and restored in
// afterAll so the spy can't leak into other test files sharing the worker
// and silence their real warnings.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  warnSpy.mockRestore();
});

// Find the single recorded query against a given collection. Asserts
// exactly one exists so a typo'd/duplicated collection name fails loudly.
function queryFor(collection: string): RecordedQuery {
  const matches = recorded.filter((q) => q.collection === collection);
  expect(matches).toHaveLength(1);
  return matches[0];
}

beforeEach(() => {
  recorded.length = 0;
  counts = {};
  throwFor = new Set();
});

describe("getPublicContributionCounts", () => {
  it("queries the five public-content collections with the right author field + public status", async () => {
    await getPublicContributionCounts("u1");

    // Exactly the five content collections — never comments (those are
    // interactions, not contributions).
    const collections = recorded.map((q) => q.collection).sort();
    expect(collections).toEqual(["guides", "polls", "posts", "projects", "qa"]);

    // posts / qa / polls / guides: authorUid + status "published".
    expect(queryFor("posts").whereCalls).toEqual([
      ["authorUid", "==", "u1"],
      ["status", "==", "published"],
    ]);
    expect(queryFor("qa").whereCalls).toEqual([
      ["authorUid", "==", "u1"],
      ["status", "==", "published"],
    ]);
    expect(queryFor("polls").whereCalls).toEqual([
      ["authorUid", "==", "u1"],
      ["status", "==", "published"],
    ]);
    expect(queryFor("guides").whereCalls).toEqual([
      ["authorUid", "==", "u1"],
      ["status", "==", "published"],
    ]);

    // projects is the odd one out: keyed on ownerUid (NOT authorUid) and
    // the public status is "approved" (the showcase review queue), not
    // "published".
    expect(queryFor("projects").whereCalls).toEqual([
      ["ownerUid", "==", "u1"],
      ["status", "==", "approved"],
    ]);
  });

  it("returns each collection's count and sums them into total", async () => {
    counts = { posts: 3, projects: 2, qa: 5, polls: 1, guides: 4 };
    const result = await getPublicContributionCounts("u1");
    expect(result).toEqual({
      posts: 3,
      projects: 2,
      qa: 5,
      polls: 1,
      guides: 4,
      total: 15,
    });
  });

  it("returns all-zero (total 0) for a user with no published content", async () => {
    const result = await getPublicContributionCounts("u1");
    expect(result).toEqual({
      posts: 0,
      projects: 0,
      qa: 0,
      polls: 0,
      guides: 0,
      total: 0,
    });
  });

  it("short-circuits to all-zero without querying Firestore when uid is empty", async () => {
    const result = await getPublicContributionCounts("");
    expect(result).toEqual({
      posts: 0,
      projects: 0,
      qa: 0,
      polls: 0,
      guides: 0,
      total: 0,
    });
    // The empty-uid guard must return before any aggregation fires.
    expect(recorded).toHaveLength(0);
  });

  it("degrades a single failing aggregation to 0 without rejecting the whole call", async () => {
    // qa's aggregation throws; the other four still resolve and the
    // failing type contributes 0 to both its slot and the total.
    counts = { posts: 3, projects: 2, polls: 1, guides: 4 };
    throwFor = new Set(["qa"]);
    const result = await getPublicContributionCounts("u1");
    expect(result).toEqual({
      posts: 3,
      projects: 2,
      qa: 0,
      polls: 1,
      guides: 4,
      total: 10,
    });
  });

  it("degrades to an all-zero result if every aggregation fails", async () => {
    throwFor = new Set(["posts", "projects", "qa", "polls", "guides"]);
    const result = await getPublicContributionCounts("u1");
    expect(result).toEqual({
      posts: 0,
      projects: 0,
      qa: 0,
      polls: 0,
      guides: 0,
      total: 0,
    });
  });
});
