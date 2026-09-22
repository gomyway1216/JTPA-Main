import { describe, expect, it } from "vitest";
import { buildSearchDocuments, searchDocuments, searchQuery, SEARCH_QUERY_MAX_LENGTH } from "@/lib/site-search";
import type { EventDoc, GuideDoc, PostDoc, ProjectDoc } from "@/lib/types";

const post = (overrides: Partial<PostDoc> = {}) => ({
  slug: "report", status: "published", title: "Claude Codeの使い方", excerpt: "開催レポート",
  body: "メール自動化と開発", tags: ["AI"], ...overrides,
} as PostDoc);
const guide = (overrides: Partial<GuideDoc> = {}) => ({
  slug: "tips", status: "published", title: "Tips", body: "Claude Code automation", tags: [], ...overrides,
} as GuideDoc);
const project = (overrides: Partial<ProjectDoc> = {}) => ({
  slug: "tool", status: "approved", title: "メールツール", description: "Claude Code", tags: [], ...overrides,
} as ProjectDoc);
const event = (overrides: Partial<EventDoc> = {}) => ({
  slug: "meetup", status: "published", title: "勉強会", description: "Claude Code入門", ...overrides,
} as EventDoc);
const sources = (overrides: Partial<Parameters<typeof buildSearchDocuments>[0]> = {}) => ({
  posts: [post()], guides: [guide()], projects: [project()], events: [event()], ...overrides,
});

describe("public site search", () => {
  it("finds all four content types and ranks title matches before body matches", () => {
    const result = searchDocuments(buildSearchDocuments(sources(), "ja"), "Claude Code");
    expect(result.total).toBe(4);
    expect(result.results[0].href).toBe("/blog/report");
    expect(result.results.map((r) => r.kind).sort()).toEqual(["event", "guide", "post", "project"]);
  });

  it("matches Japanese, tags, code samples, full-width text and mixed case; requires all words", () => {
    const docs = buildSearchDocuments(sources({ posts: [post({ body: "```\nAgentCommand\n``` メール自動化" })] }), "ja");
    expect(searchDocuments(docs, "ＣＬＡＵＤＥ　ｃｏｄｅ").total).toBe(4);
    expect(searchDocuments(docs, "AI メール自動化").total).toBe(1);
    expect(searchDocuments(docs, "agentcommand").total).toBe(1);
    expect(searchDocuments(docs, "Claude unknown").total).toBe(0);
    expect(searchDocuments(docs, " 　").total).toBe(0);
  });

  it("excludes drafts, pending/rejected/archived content, cancelled and members-only events", () => {
    const docs = buildSearchDocuments(sources({
      posts: ["draft", "pending", "rejected", "archived"].map((status) => post({ status: status as PostDoc["status"] })),
      guides: [guide({ status: "draft" }), guide({ status: "pending" })],
      projects: [project({ status: "pending" }), project({ status: "rejected" })],
      events: [event({ status: "draft" }), event({ status: "cancelled" }), event({ visibility: "members_only" }), event({ status: "past", visibility: "members_only" })],
    }), "ja");
    expect(docs).toEqual([]);
    expect(buildSearchDocuments(sources({ events: [event({ status: "past" })] }), "ja").some((d) => d.kind === "event")).toBe(true);
  });

  it("uses the displayed translation and the existing fallback for untranslated content", () => {
    const input = sources({ posts: [post({ localized: {
      ja: { title: "日本語の発表", excerpt: "要約", body: "自動化" },
      en: { title: "English presentation", excerpt: "Summary", body: "Automation" },
    } })] });
    expect(searchDocuments(buildSearchDocuments(input, "en"), "presentation").results[0].title).toBe("English presentation");
    expect(searchDocuments(buildSearchDocuments(input, "ja"), "presentation").total).toBe(0);
    expect(searchDocuments(buildSearchDocuments(input, "ja"), "日本語").total).toBe(1);
    expect(searchDocuments(buildSearchDocuments(sources(), "en"), "使い方").total).toBe(1);
  });

  it("returns only public result fields and plain excerpts", () => {
    const docs = buildSearchDocuments(sources({ posts: [post({ excerpt: "**要約** [リンク](https://example.com)", reviewNote: "private review", authorUid: "private-id" })] }), "ja");
    expect(searchDocuments(docs, "private").total).toBe(0);
    const result = searchDocuments(docs, "使い方").results[0];
    expect(result).toEqual({ kind: "post", href: "/blog/report", title: "Claude Codeの使い方", excerpt: "要約 リンク" });
    expect(JSON.stringify(docs)).not.toContain("private-id");
  });

  it("paginates without dropping older items and bounds malformed page inputs", () => {
    const docs = buildSearchDocuments(sources({ posts: Array.from({ length: 45 }, (_, i) => post({ slug: `post-${String(i).padStart(2, "0")}` })), guides: [], projects: [], events: [] }), "ja");
    const first = searchDocuments(docs, "Claude", 1);
    const last = searchDocuments(docs, "Claude", 99);
    expect(first).toMatchObject({ total: 45, page: 1, pages: 3 });
    expect(first.results).toHaveLength(20);
    expect(last).toMatchObject({ total: 45, page: 3 });
    expect(last.results).toHaveLength(5);
    expect(last.results[4].href).toBe("/blog/post-44");
    for (const page of [0, -1, NaN, Infinity, 1.5]) expect(searchDocuments(docs, "Claude", page).page).toBe(1);
  });

  it("handles empty/repeated/overlong query parameters and incomplete legacy documents", () => {
    expect(searchQuery(["one", "two"])).toBe("");
    expect(searchQuery(undefined)).toBe("");
    expect(searchQuery("a".repeat(500))).toHaveLength(SEARCH_QUERY_MAX_LENGTH);
    expect(buildSearchDocuments(sources({ posts: [post({ slug: "" }), post({ title: "" })], guides: [], projects: [], events: [] }), "ja")).toEqual([]);
  });
});
