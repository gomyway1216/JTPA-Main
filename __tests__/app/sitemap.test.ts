import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  posts: vi.fn(), guides: vi.fn(), events: vi.fn(), projects: vi.fn(),
}));
vi.mock("@/lib/data/posts", () => ({ listPublishedPosts: data.posts }));
vi.mock("@/lib/data/guides", () => ({ listGuides: data.guides }));
vi.mock("@/lib/data/events", () => ({ listEvents: data.events }));
vi.mock("@/lib/data/projects", () => ({ listProjects: data.projects }));

import sitemap from "@/app/sitemap";

beforeEach(() => {
  for (const loader of Object.values(data)) loader.mockResolvedValue([]);
});

describe("sitemap", () => {
  it("lists only real translated bodies, matching their canonical alternates", async () => {
    data.posts.mockResolvedValue([
      { slug: "japanese", locales: ["ja", "en"], localized: {
        ja: { title: "日本語", excerpt: "抜粋", body: "本文" },
        en: { title: "Incomplete" },
      } },
      { slug: "bilingual", localized: {
        ja: { title: "日本語", excerpt: "抜粋", body: "本文" },
        en: { title: "English", excerpt: "Excerpt", body: "Body" },
      } },
    ]);
    data.guides.mockResolvedValue([{ slug: "english", locales: ["en"] }]);
    data.projects.mockResolvedValue([{ slug: "legacy" }]);
    const result = await sitemap();
    const paths = result.map((entry) => new URL(entry.url).pathname);
    expect(paths).toEqual(expect.arrayContaining([
      "/ja/blog/japanese", "/ja/blog/bilingual", "/en/blog/bilingual",
      "/en/guide/english", "/ja/showcase/legacy", "/en/events", "/ja/events",
    ]));
    expect(paths).not.toContain("/en/blog/japanese");
    expect(paths).not.toContain("/ja/guide/english");
    expect(paths).not.toContain("/en/showcase/legacy");
    const bilingual = result.filter((entry) => entry.url.endsWith("/blog/bilingual"));
    expect(bilingual[0].alternates).toEqual(bilingual[1].alternates);
    expect(Object.keys(bilingual[0].alternates!.languages!)).toEqual(["ja", "en", "x-default"]);
  });

  it("excludes members-only events and duplicate English event bodies", async () => {
    data.events.mockResolvedValue([
      { slug: "public", visibility: "public" },
      { slug: "private", visibility: "members_only" },
    ]);
    const result = await sitemap();
    const eventDetails = result.filter((entry) => /\/events\//.test(entry.url));
    expect(eventDetails).toHaveLength(1);
    expect(new URL(eventDetails[0].url).pathname).toBe("/ja/events/public");
    expect(Object.keys(eventDetails[0].alternates!.languages!)).toEqual(["ja", "x-default"]);
    expect(data.events).toHaveBeenCalledWith({ statuses: ["published", "past"], limit: 500 });
  });

  it("still serves static bilingual URLs when a content store is unavailable", async () => {
    for (const loader of Object.values(data)) loader.mockRejectedValue(new Error("offline"));
    const result = await sitemap();
    expect(result.map((entry) => new URL(entry.url).pathname)).toEqual(
      expect.arrayContaining(["/ja", "/en", "/ja/about", "/en/about"]),
    );
  });
});
