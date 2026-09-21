import { beforeEach, describe, expect, it, vi } from "vitest";

const data = vi.hoisted(() => ({
  event: vi.fn(), post: vi.fn(), guide: vi.fn(), project: vi.fn(), qa: vi.fn(), poll: vi.fn(),
}));
vi.mock("@/lib/data/events", () => ({ getEventBySlug: data.event }));
vi.mock("@/lib/data/cached", () => ({
  getPostBySlugCached: data.post,
  getGuideBySlugCached: data.guide,
  getProjectBySlugCached: data.project,
}));
vi.mock("@/lib/data/qa", () => ({ getQaBySlug: data.qa }));
vi.mock("@/lib/data/poll", () => ({ getPollBySlug: data.poll }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/firebase/client", () => ({}));
vi.mock("@/i18n/navigation", () => ({ default: () => null }));

import { generateMetadata as eventMetadata } from "@/app/[locale]/events/[slug]/page";
import { generateMetadata as blogMetadata } from "@/app/[locale]/blog/[slug]/page";
import { generateMetadata as guideMetadata } from "@/app/[locale]/guide/[slug]/page";
import { generateMetadata as projectMetadata } from "@/app/[locale]/showcase/[slug]/page";
import { generateMetadata as qaMetadata } from "@/app/[locale]/qa/[slug]/page";
import { generateMetadata as pollMetadata } from "@/app/[locale]/poll/[slug]/page";

const params = Promise.resolve({ locale: "en", slug: "example" });

beforeEach(() => {
  for (const loader of Object.values(data)) loader.mockResolvedValue(null);
});

describe("detail metadata", () => {
  it.each([
    ["events", data.event, eventMetadata],
    ["blog", data.post, blogMetadata],
    ["guide", data.guide, guideMetadata],
    ["showcase", data.project, projectMetadata],
    ["qa", data.qa, qaMetadata],
    ["poll", data.poll, pollMetadata],
  ])("keeps %s sharing URLs aligned with the content canonical", async (section, loader, generate) => {
    loader.mockResolvedValue({
      slug: "example", title: "日本語", excerpt: "抜粋", body: "本文", description: "説明",
      options: [{ id: "1", label: "選択肢" }, { id: "2", label: "その他" }],
      status: section === "showcase" ? "approved" : "published",
    });
    const metadata = await generate({ params });
    expect(metadata.alternates?.canonical).toMatch(new RegExp(`/ja/${section}/example$`));
    expect(metadata.openGraph?.url).toBe(metadata.alternates?.canonical);
    expect(metadata.alternates?.languages).not.toHaveProperty("en");
  });

  it.each([
    [data.event, eventMetadata], [data.post, blogMetadata], [data.guide, guideMetadata],
    [data.project, projectMetadata], [data.qa, qaMetadata], [data.poll, pollMetadata],
  ])("omits unpublished copy and marks previews noindex", async (loader, generate) => {
    loader.mockResolvedValue({ status: "draft", title: "Private title", description: "Private copy" });
    expect(await generate({ params })).toEqual({ robots: { index: false, follow: false } });
  });

  it("never exposes members-only event copy in metadata", async () => {
    data.event.mockResolvedValue({ status: "published", visibility: "members_only", title: "Private" });
    expect(await eventMetadata({ params })).toEqual({ robots: { index: false, follow: false } });
  });

  it("keeps a real English article self-canonical with article dates", async () => {
    data.post.mockResolvedValue({
      slug: "example", status: "published", title: "原文", excerpt: "抜粋", body: "本文",
      publishedAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-02T00:00:00Z",
      localized: { en: { title: "English", excerpt: "Excerpt", body: "Body" } },
    });
    const metadata = await blogMetadata({ params });
    expect(metadata.title).toBe("English");
    expect(metadata.alternates?.canonical).toMatch(/\/en\/blog\/example$/);
    expect(metadata.openGraph).toMatchObject({
      type: "article", publishedTime: "2026-09-01T00:00:00.000Z", modifiedTime: "2026-09-02T00:00:00.000Z",
    });
  });
});
