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
});
