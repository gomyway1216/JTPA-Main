import { beforeEach, describe, expect, it, vi } from "vitest";

// Wiring tests for the cross-request data cache (src/lib/data/cached.ts).
// The point is to pin the contract between the cached readers and the
// server actions that invalidate them: tags and revalidate windows are
// the coupling surface, and a silent drift on either side would strand
// stale content in production. `unstable_cache` itself is Next.js's —
// we only assert what we hand it and that calls delegate with the right
// arguments.

interface RecordedWrap {
  cb: (...args: unknown[]) => unknown;
  keyParts: string[] | undefined;
  options: { tags?: string[]; revalidate?: number | false } | undefined;
}

// vi.hoisted: the next/cache mock factory runs while cached.ts is being
// imported (module-level wrappers register immediately), which is before
// ordinary module-scope consts in this file initialize.
const wraps = vi.hoisted(() => [] as RecordedWrap[]);

vi.mock("next/cache", () => ({
  unstable_cache: (
    cb: (...args: unknown[]) => unknown,
    keyParts?: string[],
    options?: RecordedWrap["options"],
  ) => {
    const wrap: RecordedWrap = { cb, keyParts, options };
    wraps.push(wrap);
    // Pass-through: invoking the "cached" function runs the underlying
    // callback directly.
    return (...args: unknown[]) => cb(...args);
  },
}));

const listPublishedPostsMock = vi.fn();
const listPublishedPostsForLocaleMock = vi.fn();
const getPostBySlugMock = vi.fn();
const listGuidesMock = vi.fn();
const getGuideBySlugMock = vi.fn();
const listProjectsMock = vi.fn();
const getProjectBySlugMock = vi.fn();
const listEventsMock = vi.fn();
const listPastEventsMock = vi.fn();
const readSitePageMock = vi.fn();

vi.mock("@/lib/data/posts", () => ({
  listPublishedPosts: (...args: unknown[]) => listPublishedPostsMock(...args),
  listPublishedPostsForLocale: (...args: unknown[]) =>
    listPublishedPostsForLocaleMock(...args),
  getPostBySlug: (...args: unknown[]) => getPostBySlugMock(...args),
}));
vi.mock("@/lib/data/guides", () => ({
  listGuides: (...args: unknown[]) => listGuidesMock(...args),
  getGuideBySlug: (...args: unknown[]) => getGuideBySlugMock(...args),
}));
vi.mock("@/lib/data/projects", () => ({
  listProjects: (...args: unknown[]) => listProjectsMock(...args),
  getProjectBySlug: (...args: unknown[]) => getProjectBySlugMock(...args),
}));
vi.mock("@/lib/data/events", () => ({
  listEvents: (...args: unknown[]) => listEventsMock(...args),
  listPastEvents: (...args: unknown[]) => listPastEventsMock(...args),
}));
vi.mock("@/lib/data/site-pages", () => ({
  readSitePage: (...args: unknown[]) => readSitePageMock(...args),
}));

import {
  CONTENT_REVALIDATE_SECONDS,
  EVENTS_REVALIDATE_SECONDS,
  getGuideBySlugCached,
  getPostBySlugCached,
  getProjectBySlugCached,
  getSitePageCached,
  listApprovedProjectsForLocaleCached,
  listApprovedProjectsCached,
  listPastEventsCached,
  listPublishedGuidesCached,
  listPublishedPostsForLocaleCached,
  listPublishedPostsCached,
  listUpcomingEventsCached,
} from "@/lib/data/cached";

beforeEach(() => {
  listPublishedPostsMock.mockReset();
  listPublishedPostsForLocaleMock.mockReset();
  getPostBySlugMock.mockReset();
  listGuidesMock.mockReset();
  getGuideBySlugMock.mockReset();
  listProjectsMock.mockReset();
  getProjectBySlugMock.mockReset();
  listEventsMock.mockReset();
  listPastEventsMock.mockReset();
  readSitePageMock.mockReset();
});

describe("revalidate windows", () => {
  it("uses a 5-minute window for editorial content and 60s for events", () => {
    // These constants ARE the worst-case staleness bound on Cloud Run
    // instances that didn't handle the mutating action (tag invalidation
    // is per-instance) — change them deliberately.
    expect(CONTENT_REVALIDATE_SECONDS).toBe(300);
    expect(EVENTS_REVALIDATE_SECONDS).toBe(60);
  });
});

describe("list wrappers — tags, windows, delegation", () => {
  const cases: Array<{
    name: string;
    call: () => unknown;
    mock: ReturnType<typeof vi.fn>;
    expectedArgs: unknown[];
    tag: string;
    revalidate: number;
  }> = [
    {
      name: "listPublishedPostsCached",
      call: () => listPublishedPostsCached(50),
      mock: listPublishedPostsMock,
      expectedArgs: [50],
      tag: "posts",
      revalidate: CONTENT_REVALIDATE_SECONDS,
    },
    {
      name: "listPublishedPostsForLocaleCached",
      call: () => listPublishedPostsForLocaleCached("en", 50),
      mock: listPublishedPostsForLocaleMock,
      expectedArgs: ["en", 50],
      tag: "posts",
      revalidate: CONTENT_REVALIDATE_SECONDS,
    },
    {
      name: "listPublishedGuidesCached",
      call: () => listPublishedGuidesCached(200),
      mock: listGuidesMock,
      expectedArgs: [{ statuses: ["published"], limit: 200 }],
      tag: "guides",
      revalidate: CONTENT_REVALIDATE_SECONDS,
    },
    {
      name: "listApprovedProjectsCached",
      call: () => listApprovedProjectsCached(6),
      mock: listProjectsMock,
      expectedArgs: [{ limit: 6 }],
      tag: "projects",
      revalidate: CONTENT_REVALIDATE_SECONDS,
    },
    {
      name: "listApprovedProjectsForLocaleCached",
      call: () => listApprovedProjectsForLocaleCached("ja", 6),
      mock: listProjectsMock,
      expectedArgs: [{ limit: 6, locale: "ja" }],
      tag: "projects",
      revalidate: CONTENT_REVALIDATE_SECONDS,
    },
    {
      name: "listUpcomingEventsCached",
      call: () => listUpcomingEventsCached(3),
      mock: listEventsMock,
      expectedArgs: [{ notEndedOnly: true, limit: 3 }],
      tag: "events",
      revalidate: EVENTS_REVALIDATE_SECONDS,
    },
    {
      name: "listPastEventsCached",
      call: () => listPastEventsCached(10),
      mock: listPastEventsMock,
      expectedArgs: [10],
      tag: "events",
      revalidate: EVENTS_REVALIDATE_SECONDS,
    },
    {
      name: "getSitePageCached",
      call: () => getSitePageCached("about"),
      mock: readSitePageMock,
      expectedArgs: ["about"],
      tag: "site-pages",
      revalidate: CONTENT_REVALIDATE_SECONDS,
    },
  ];

  for (const c of cases) {
    it(`${c.name} delegates with the right args under tag "${c.tag}"`, () => {
      c.call();
      expect(c.mock).toHaveBeenCalledTimes(1);
      expect(c.mock).toHaveBeenCalledWith(...c.expectedArgs);

      // The wrap whose callback drives this mock must carry the tag the
      // mutating server actions expire, plus the agreed window.
      c.mock.mockClear();
      const wrap = wraps.find((w) => {
        w.cb(...c.expectedArgs);
        const hit = c.mock.mock.calls.length > 0;
        c.mock.mockClear();
        return hit;
      });
      expect(wrap).toBeDefined();
      expect(wrap?.options?.tags).toEqual([c.tag]);
      expect(wrap?.options?.revalidate).toBe(c.revalidate);
    });
  }
});

describe("detail wrappers — collection + entity tags", () => {
  const cases: Array<{
    name: string;
    call: () => unknown;
    mock: ReturnType<typeof vi.fn>;
    slug: string;
    tags: string[];
  }> = [
    {
      name: "getPostBySlugCached",
      call: () => getPostBySlugCached("hello"),
      mock: getPostBySlugMock,
      slug: "hello",
      tags: ["posts", "post:hello"],
    },
    {
      name: "getGuideBySlugCached",
      call: () => getGuideBySlugCached("setup"),
      mock: getGuideBySlugMock,
      slug: "setup",
      tags: ["guides", "guide:setup"],
    },
    {
      name: "getProjectBySlugCached",
      call: () => getProjectBySlugCached("my-app"),
      mock: getProjectBySlugMock,
      slug: "my-app",
      tags: ["projects", "project:my-app"],
    },
  ];

  for (const c of cases) {
    it(`${c.name} tags the entry with collection AND entity tags`, () => {
      const before = wraps.length;
      c.call();
      // Detail readers build the unstable_cache wrapper per call so the
      // entity tag can include the slug.
      expect(wraps.length).toBe(before + 1);
      const wrap = wraps[wraps.length - 1];
      expect(wrap.options?.tags).toEqual(c.tags);
      expect(wrap.options?.revalidate).toBe(CONTENT_REVALIDATE_SECONDS);
      expect(c.mock).toHaveBeenCalledWith(c.slug);
    });
  }
});
