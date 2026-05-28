import { beforeEach, describe, expect, it, vi } from "vitest";

// getSitePage wraps the Firestore read in React's cache(). Outside a
// real Server Component render, cache() falls through to the inner
// function on each call, so we can exercise it like any async helper.

const docMock = { get: vi.fn() };
const collectionMock = vi.fn(() => ({ doc: () => docMock }));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({ collection: collectionMock }),
}));

import { getSitePage } from "@/lib/data/site-pages";

beforeEach(() => {
  docMock.get.mockReset();
  collectionMock.mockClear();
});

describe("getSitePage", () => {
  it("reads from sitePages/{slug} and returns null when absent", async () => {
    // Fresh deploy with no admin save yet → caller falls back to
    // SITE_PAGE_DEFAULTS rather than rendering a blank page.
    docMock.get.mockResolvedValueOnce({ exists: false });
    expect(await getSitePage("about")).toBeNull();
    expect(collectionMock).toHaveBeenCalledWith("sitePages");
  });

  it("returns the doc with id stamped on when present", async () => {
    docMock.get.mockResolvedValueOnce({
      exists: true,
      id: "about",
      data: () => ({
        slug: "about",
        title: "JTPAとは",
        body: "edited",
      }),
    });
    const out = await getSitePage("about");
    expect(out).toEqual({
      id: "about",
      slug: "about",
      title: "JTPAとは",
      body: "edited",
    });
  });
});
