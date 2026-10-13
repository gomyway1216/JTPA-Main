import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ja from "../../messages/ja.json";
import en from "../../messages/en.json";

const context = vi.hoisted(() => ({ locale: "ja" as "ja" | "en", getDocuments: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale }: { locale: "ja" | "en" }) => createTranslator({ locale, messages: locale === "ja" ? ja : en, namespace: "SearchPage" }),
}));
vi.mock("@/lib/data/search", () => ({ getSearchDocuments: context.getDocuments }));
vi.mock("@/i18n/navigation", () => ({
  default: ({ children, href }: { children: ReactNode; href: string | { pathname: string; query: Record<string, string | number> } }) => {
    const path = typeof href === "string" ? href : `${href.pathname}?${new URLSearchParams(Object.entries(href.query).map(([k, v]) => [k, String(v)]))}`;
    return createElement("a", { href: `/${context.locale}${path}` }, children);
  },
}));
import SearchPage, { generateMetadata } from "@/app/[locale]/search/page";

async function render(q?: string, page?: string) {
  return renderToStaticMarkup(await SearchPage({ params: Promise.resolve({ locale: context.locale }), searchParams: Promise.resolve({ q, page }) }));
}

beforeEach(() => { context.locale = "ja"; context.getDocuments.mockReset().mockResolvedValue([]); });

describe("search page", () => {
  it.each(["ja", "en"] as const)("renders an accessible GET form without loading the corpus for an empty %s search", async (locale) => {
    context.locale = locale;
    const html = await render();
    expect(html).toContain(`action="/${locale}/search"`);
    expect(html).toContain('method="get"');
    expect(html).toContain('role="search"');
    expect(html).toContain('for="site-search"');
    expect(context.getDocuments).not.toHaveBeenCalled();
    expect(await generateMetadata({ params: Promise.resolve({ locale }) })).toMatchObject({ robots: { index: false, follow: true } });
  });

  it("shows an explicit empty state and safely escapes the search query", async () => {
    const html = await render('<script>alert("x")</script>');
    expect(html).toContain(ja.SearchPage.empty);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(context.getDocuments).toHaveBeenCalledWith("ja");
  });

  it("renders localized result links and keeps the query when paging", async () => {
    context.locale = "en";
    context.getDocuments.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({
      kind: "post", href: `/blog/${i}`, title: `AI ${i}`, excerpt: "Summary",
      titleText: "ai", tagsText: "", bodyText: "server-only-long-body",
    })));
    const html = await render("AI");
    expect(html).toContain('href="/en/blog/0"');
    expect(html).toContain('href="/en/search?q=AI&amp;page=2"');
    expect(html).toContain("21 results");
    expect(html).not.toContain("server-only-long-body");
  });
});
