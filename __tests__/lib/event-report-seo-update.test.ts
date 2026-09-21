import { describe, expect, it } from "vitest";

import { reportContentHash, reportUpdate } from "../../scripts/update-event-report-seo.mjs";

const original = { title: "Report", excerpt: "Original excerpt", body: "Original body\n\n![Photo](https://example.com/photo.jpg)" };
const post = { ...original, slug: "ai-4", status: "published", localized: { ja: original }, locales: ["ja"], authorUid: "author" };
const edit = {
  slug: "ai-4", expectedHash: reportContentHash(post),
  ja: { ...original, title: "AI agent examples | Report", body: `## Summary\n\nOverview\n\n${original.body}` },
  en: { title: "AI agent examples", excerpt: "English excerpt", body: "English translation" },
};

describe("reviewed report update", () => {
  it("updates both content locales without changing author or publication metadata", () => {
    const update = reportUpdate(post, edit);
    expect(update).toEqual({
      title: edit.ja.title, excerpt: edit.ja.excerpt, body: edit.ja.body,
      "localized.ja": edit.ja, "localized.en": edit.en, locales: ["ja", "en"],
    });
    expect(update?.body).toContain(original.body);
  });

  it("refuses to overwrite a concurrent edit in either source representation or translation", () => {
    for (const changed of [
      { ...post, body: "An author's newer draft" },
      { ...post, localized: { ja: { ...original, title: "Corrected title" } } },
      { ...post, localized: { ...post.localized, en: edit.en } },
    ]) expect(() => reportUpdate(changed, edit)).toThrow("refusing to overwrite");
  });

  it("refuses to republish an archived report or modify a different post", () => {
    expect(() => reportUpdate({ ...post, status: "archived" }, edit)).toThrow("expected published report");
    expect(() => reportUpdate({ ...post, slug: "other" }, edit)).toThrow("expected published report");
  });

  it("makes a completed update a no-op on subsequent runs", () => {
    const updated = { ...post, ...edit.ja, localized: { ja: edit.ja, en: edit.en }, locales: ["ja", "en"] };
    expect(reportUpdate(updated, edit)).toBeNull();
  });

  it("does not invalidate the review when only unrelated counters change", () => {
    expect(reportContentHash({ ...post, likeCount: 42 })).toBe(edit.expectedHash);
  });
});
