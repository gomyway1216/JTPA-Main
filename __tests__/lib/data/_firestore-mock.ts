// Tiny shared helper for data-layer query tests.
//
// Each test file mocks `@/lib/firebase/admin`'s `adminDb()` with the
// `createAdminDbMock` builder below. The builder returns:
//
//   - a Firestore-like object you hand to your vi.mock factory
//   - a `state` you read from your tests to assert the query shape
//   - helpers to push synthetic snapshot results onto the next `.get()`
//
// We deliberately model the *minimum* surface our data files touch:
// `.collection(...)`, chained `.where/.orderBy/.limit`, `.doc(id).get()`,
// and `.collectionGroup(...)`. Firestore's real shape is larger.
import { vi } from "vitest";

export interface QueryState {
  // Last-touched collection (top-level OR subcollection path joined with "/").
  collection?: string;
  collectionGroup?: string;
  whereCalls: Array<[string, string, unknown]>;
  orderByCalls: Array<[string, string?]>;
  limit?: number;
  docPath?: { collection: string; id: string };
}

export type SnapStub =
  | {
      docs: Array<{
        id: string;
        data: () => unknown;
        ref?: { parent?: { parent?: { id?: string } | null } | null };
      }>;
      empty?: boolean;
    }
  | { exists: boolean; id?: string; data?: () => unknown };

function withEmpty(s: SnapStub): SnapStub {
  if ("docs" in s) return { ...s, empty: s.docs.length === 0 };
  return s;
}

export function createAdminDbMock() {
  const state: QueryState = {
    whereCalls: [],
    orderByCalls: [],
  };
  let nextGet: SnapStub = { docs: [] };
  // For `getAll(...)` calls we line up an array of per-ref results.
  let nextGetAll: Array<SnapStub> = [];

  function reset() {
    state.collection = undefined;
    state.collectionGroup = undefined;
    state.whereCalls = [];
    state.orderByCalls = [];
    state.limit = undefined;
    state.docPath = undefined;
    nextGet = { docs: [] };
    nextGetAll = [];
  }

  function setGet(s: SnapStub) {
    nextGet = s;
  }
  function setGetAll(snaps: SnapStub[]) {
    nextGetAll = snaps;
  }

  function makeQuery(pathSoFar: string) {
    const q = {
      where: vi.fn((f: string, op: string, val: unknown) => {
        state.whereCalls.push([f, op, val]);
        return q;
      }),
      orderBy: vi.fn((f: string, dir?: string) => {
        state.orderByCalls.push([f, dir]);
        return q;
      }),
      limit: vi.fn((n: number) => {
        state.limit = n;
        return q;
      }),
      get: vi.fn(async () => withEmpty(nextGet)),
      doc: (id: string) => makeDoc(pathSoFar, id),
    };
    return q;
  }

  function makeDoc(parentCol: string, id: string) {
    state.docPath = { collection: parentCol, id };
    return {
      id,
      get: vi.fn(async () => withEmpty(nextGet)),
      collection: (subName: string) => {
        const sub = `${parentCol}/${id}/${subName}`;
        state.collection = sub;
        return makeQuery(sub);
      },
    };
  }

  const adminDb = () => ({
    collection: (name: string) => {
      state.collection = name;
      return makeQuery(name);
    },
    collectionGroup: (name: string) => {
      state.collectionGroup = name;
      return makeQuery(name);
    },
    getAll: vi.fn(async () => nextGetAll.map(withEmpty)),
  });

  return { adminDb, state, reset, setGet, setGetAll };
}
