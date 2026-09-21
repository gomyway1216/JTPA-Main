import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guide: vi.fn(),
  profiles: vi.fn(),
  session: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getLocale: async () => "ja",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/i18n/navigation", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href }, children),
}));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: mocks.session }));
vi.mock("@/lib/data/cached", () => ({ getGuideBySlugCached: mocks.guide }));
vi.mock("@/lib/data/users", () => ({ getPublicProfilesByUids: mocks.profiles }));
vi.mock("@/lib/data/comments", () => ({ listComments: async () => ({ comments: [], nextCursor: null }) }));
vi.mock("@/lib/data/likes", () => ({ getMyLikesForParent: async () => new Set(), RECORD_LIKE_KEY: "record" }));
vi.mock("@/components/comments/CommentsSection", () => ({ CommentsSection: () => null }));
vi.mock("@/components/likes/LikeButton", () => ({ LikeButton: () => null }));
vi.mock("@/components/markdown/MarkdownBody", () => ({ MarkdownBody: () => null }));
vi.mock("@/components/community/ReaderNextSteps", () => ({ ReaderNextSteps: () => createElement("aside", null, "Join the community") }));

import GuideDetailPage from "@/app/[locale]/guide/[slug]/page";

const guide = {
  id: "guide-id", slug: "practical-ai", title: "A practical guide", body: "Body",
  status: "published", tags: [], updatedAt: "2026-09-20T00:00:00Z",
  authorUid: "author", authorName: "Private Legal Name",
  createdBy: { uid: "legacy-author", displayName: "Another Private Name", email: "private@example.test" },
};

describe("guide author attribution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guide.mockResolvedValue(guide);
    mocks.session.mockResolvedValue(null);
    mocks.profiles.mockResolvedValue(new Map([
      ["author", { uid: "author", username: "public-handle", fullName: null, photoURL: null }],
    ]));
  });

  async function render() {
    return renderToStaticMarkup(await GuideDetailPage({ params: Promise.resolve({ slug: guide.slug }) }));
  }

  it("attributes the guide to its public profile without leaking stored private names", async () => {
    const html = await render();
    expect(mocks.profiles).toHaveBeenCalledWith(["author"]);
    expect(html).toContain('href="/u/author"');
    expect(html).toContain("@public-handle");
    expect(html).not.toContain("Private Legal Name");
    expect(html).not.toContain("Another Private Name");
    expect(html).not.toContain("private@example.test");
    expect(html).toContain("Join the community");
  });

  it("uses the legacy creator uid but omits the byline when the profile is missing", async () => {
    mocks.guide.mockResolvedValue({ ...guide, authorUid: undefined });
    mocks.profiles.mockResolvedValue(new Map());
    const html = await render();
    expect(mocks.profiles).toHaveBeenCalledWith(["legacy-author"]);
    expect(html).not.toContain("/u/");
    expect(html).not.toContain("Another Private Name");
  });

  it("keeps participation prompts out of an author's draft preview", async () => {
    mocks.guide.mockResolvedValue({ ...guide, status: "draft" });
    mocks.session.mockResolvedValue({ uid: "author" });
    expect(await render()).not.toContain("Join the community");
  });
});
