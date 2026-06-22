import { describe, expect, it } from "vitest";

import {
  getLocalizedPostContent,
  getLocalizedProjectContent,
} from "@/lib/localized-content";

describe("localized content helpers", () => {
  it("uses the requested post locale when present", () => {
    const post = {
      title: "Fallback",
      excerpt: "Fallback excerpt",
      body: "Fallback body",
      localized: {
        ja: { title: "日本語", excerpt: "抜粋", body: "本文" },
        en: { title: "English", excerpt: "Excerpt", body: "Body" },
      },
    };

    expect(getLocalizedPostContent(post, "en")).toEqual({
      title: "English",
      excerpt: "Excerpt",
      body: "Body",
    });
  });

  it("falls back to an available post locale when requested content is missing", () => {
    const post = {
      title: "Fallback",
      excerpt: "Fallback excerpt",
      body: "Fallback body",
      localized: {
        ja: { title: "日本語", excerpt: "抜粋", body: "本文" },
      },
    };

    expect(getLocalizedPostContent(post, "en").title).toBe("日本語");
  });

  it("ignores incomplete localized post content instead of throwing", () => {
    const post = {
      title: "Fallback",
      excerpt: "Fallback excerpt",
      body: "Fallback body",
      localized: {
        ja: { title: "日本語" },
      },
    };

    expect(
      getLocalizedPostContent(
        post as unknown as Parameters<typeof getLocalizedPostContent>[0],
        "ja",
      ),
    ).toEqual({
      title: "Fallback",
      excerpt: "Fallback excerpt",
      body: "Fallback body",
    });
  });

  it("falls back to legacy project fields when no localized content exists", () => {
    const project = {
      title: "Legacy project",
      description: "Legacy description",
    };

    expect(getLocalizedProjectContent(project, "ja")).toEqual({
      title: "Legacy project",
      description: "Legacy description",
    });
  });

  it("ignores incomplete localized project content instead of throwing", () => {
    const project = {
      title: "Legacy project",
      description: "Legacy description",
      localized: {
        en: { title: "English project" },
      },
    };

    expect(
      getLocalizedProjectContent(
        project as unknown as Parameters<typeof getLocalizedProjectContent>[0],
        "en",
      ),
    ).toEqual({
      title: "Legacy project",
      description: "Legacy description",
    });
  });
});
