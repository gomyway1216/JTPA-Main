import {
  getLocalizedGuideContent,
  getLocalizedPostContent,
  getLocalizedProjectContent,
} from "@/lib/localized-content";
import type { EventDoc, GuideDoc, PostDoc, ProjectDoc } from "@/lib/types";
import { stripMarkdown, truncate } from "@/lib/utils";

export const SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_PAGE_SIZE = 20;
export type SearchKind = "post" | "guide" | "project" | "event";

export interface SearchDocument {
  kind: SearchKind;
  href: string;
  title: string;
  excerpt: string;
  // These fields stay on the server; results expose only the fields above.
  titleText: string;
  tagsText: string;
  bodyText: string;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function searchQuery(value: string | string[] | undefined): string {
  return (typeof value === "string" ? value : "")
    .slice(0, SEARCH_QUERY_MAX_LENGTH).replace(/\s+/gu, " ").trim();
}

function document(
  kind: SearchKind, path: string, slug: string, title: string,
  body: string, tags: string[] = [], excerpt = "",
): SearchDocument[] {
  // Firestore validation is warn-only. One malformed public record must not
  // break searches across otherwise valid content in the other collections.
  if (typeof slug !== "string" || !slug.trim() || typeof title !== "string" || !title.trim()) return [];
  const safeTags = Array.isArray(tags) ? tags.filter((tag) => typeof tag === "string") : [];
  const safeExcerpt = typeof excerpt === "string" ? excerpt : "";
  // Keep code samples searchable while removing Markdown presentation.
  const text = stripMarkdown((typeof body === "string" ? body : "").replace(/`/g, ""));
  return [{
    kind,
    href: `${path}/${encodeURIComponent(slug)}`,
    title,
    excerpt: truncate(stripMarkdown(safeExcerpt || text), 180),
    titleText: normalize(title),
    tagsText: normalize(safeTags.join(" ")),
    bodyText: normalize(`${safeExcerpt} ${text}`),
  }];
}

export function buildSearchDocuments(
  sources: { posts: PostDoc[]; guides: GuideDoc[]; projects: ProjectDoc[]; events: EventDoc[] },
  locale: string,
): SearchDocument[] {
  return [
    ...sources.posts.filter((p) => p.status === "published").flatMap((p) => {
      const c = getLocalizedPostContent(p, locale);
      return document("post", "/blog", p.slug, c.title, c.body, p.tags, c.excerpt);
    }),
    ...sources.guides.filter((g) => g.status === "published").flatMap((g) => {
      const c = getLocalizedGuideContent(g, locale);
      return document("guide", "/guide", g.slug, c.title, c.body, g.tags);
    }),
    ...sources.projects.filter((p) => p.status === "approved").flatMap((p) => {
      const c = getLocalizedProjectContent(p, locale);
      return document("project", "/showcase", p.slug, c.title, c.description, p.tags);
    }),
    ...sources.events.filter((e) =>
      (e.status === "published" || e.status === "past") &&
      (e.visibility === undefined || e.visibility === "public"),
    ).flatMap((e) => document("event", "/events", e.slug, e.title, e.description, [], e.summary)),
  ];
}

export function searchDocuments(documents: SearchDocument[], query: string, requestedPage = 1) {
  const terms = [...new Set(normalize(searchQuery(query)).split(" ").filter(Boolean))];
  const matches = terms.length === 0 ? [] : documents.flatMap((doc) => {
    const fields = `${doc.titleText} ${doc.tagsText} ${doc.bodyText}`;
    if (!terms.every((term) => fields.includes(term))) return [];
    const score = terms.reduce((sum, term) => sum +
      (doc.titleText.includes(term) ? 6 : 0) +
      (doc.tagsText.includes(term) ? 3 : 0), 0);
    return [{ doc, score }];
  }).sort((a, b) => b.score - a.score || a.doc.href.localeCompare(b.doc.href));
  const total = matches.length;
  const pages = Math.max(1, Math.ceil(total / SEARCH_PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(pages, Math.max(1, requestedPage)) : 1;
  const results = matches.slice((page - 1) * SEARCH_PAGE_SIZE, page * SEARCH_PAGE_SIZE)
    .map(({ doc: { kind, href, title, excerpt } }) => ({ kind, href, title, excerpt }));
  return { results, total, page, pages };
}
