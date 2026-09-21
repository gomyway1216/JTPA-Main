import { describe, expect, it } from "vitest";

import {
  getLocalizedGuideContent,
  getPostContentLocales,
  getGuideContentLocales,
  getProjectContentLocales,
  getQaContentLocales,
  getPollContentLocales,
  getLocalizedPollContent,
  getLocalizedPostContent,
  getLocalizedProjectContent,
  getLocalizedQaContent,
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

  it("resolves localized guide and Q&A content", () => {
    expect(
      getLocalizedGuideContent(
        {
          title: "Legacy guide",
          body: "Legacy body",
          localized: {
            en: { title: "Guide", body: "Body" },
          },
        },
        "en",
      ),
    ).toEqual({ title: "Guide", body: "Body" });

    expect(
      getLocalizedQaContent(
        {
          title: "Legacy Q&A",
          body: "Legacy body",
          localized: {
            ja: { title: "質問", body: "本文" },
          },
        },
        "en",
      ),
    ).toEqual({ title: "質問", body: "本文" });
  });

  it("resolves localized poll title, description, and option labels", () => {
    const poll = {
      title: "Legacy poll",
      description: "Legacy description",
      options: [
        { id: "a", label: "A", voteCount: 2 },
        { id: "b", label: "B", voteCount: 1 },
      ],
      localized: {
        en: {
          title: "Poll",
          description: "Description",
          options: [
            { id: "a", label: "Option A" },
            { id: "b", label: "Option B" },
          ],
        },
      },
    };

    expect(getLocalizedPollContent(poll, "en")).toEqual({
      title: "Poll",
      description: "Description",
      options: [
        { id: "a", label: "Option A", voteCount: 2 },
        { id: "b", label: "Option B", voteCount: 1 },
      ],
    });
  });
});

describe("indexable content languages", () => {
  it("uses the same completeness criteria as the rendered post body", () => {
    expect(getPostContentLocales({ locales: ["ja", "en"], localized: {
      ja: { title: "日本語", excerpt: "抜粋", body: "本文" },
      en: { title: "English", excerpt: "Excerpt", body: " " },
    } })).toEqual(["ja"]);
  });

  it("indexes complete localized bodies even if old locale flags disagree", () => {
    expect(getGuideContentLocales({ locales: ["ja"], localized: {
      en: { title: "English", body: "Body" },
    } })).toEqual(["en"]);
    expect(getProjectContentLocales({ localized: {
      ja: { title: "日本語", description: "本文" },
      en: { title: "English", description: "Body" },
    } })).toEqual(["ja", "en"]);
  });

  it("does not claim two translations for legacy shared bodies", () => {
    expect(getQaContentLocales({ locales: ["ja", "en"] })).toEqual(["ja"]);
    expect(getQaContentLocales({ locales: ["en"] })).toEqual(["en"]);
    expect(getPollContentLocales({})).toEqual(["ja"]);
    expect(getPollContentLocales({ localized: {
      en: { title: "Poll", description: "", options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] },
    } })).toEqual(["en"]);
  });
});
