import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Link from "@/i18n/navigation";
import { getSearchDocuments } from "@/lib/data/search";
import { searchDocuments, searchQuery, SEARCH_QUERY_MAX_LENGTH } from "@/lib/site-search";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SearchPage" });
  return { title: t("title"), description: t("description"), robots: { index: false, follow: true } };
}

export default async function SearchPage({ params, searchParams }: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[]; page?: string | string[] }>;
}) {
  const [{ locale }, input] = await Promise.all([params, searchParams]);
  const t = await getTranslations({ locale, namespace: "SearchPage" });
  const query = searchQuery(input.q);
  const documents = query ? await getSearchDocuments(locale) : [];
  const { results, total, page, pages } = searchDocuments(documents, query,
    typeof input.page === "string" ? Number(input.page) : 1);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-12">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("title")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t("description")}</p>
      </header>
      <form action={`/${locale}/search`} method="get" role="search" className="space-y-2">
        <label htmlFor="site-search" className="block text-sm font-medium">{t("label")}</label>
        <div className="flex gap-2">
          <input id="site-search" name="q" type="search" defaultValue={query}
            maxLength={SEARCH_QUERY_MAX_LENGTH} placeholder={t("placeholder")}
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950" />
          <button type="submit" className="shrink-0 rounded-lg bg-zinc-900 px-5 py-2 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">{t("submit")}</button>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("hint")}</p>
      </form>
      {!query ? (
        <p className="rounded-xl bg-zinc-50 p-6 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{t("initial")}</p>
      ) : (
        <section aria-labelledby="search-results-heading" className="space-y-5">
          <h2 id="search-results-heading" className="text-lg font-semibold">{t("results", { query, count: total })}</h2>
          {total === 0 ? <p className="text-zinc-600 dark:text-zinc-400">{t("empty")}</p> : (
            <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {results.map((result) => (
                <li key={result.href} className="space-y-2 py-5 first:pt-0">
                  <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{t(`kinds.${result.kind}`)}</span>
                  <h3 className="text-xl font-semibold break-words"><Link href={result.href} className="text-accent hover:underline">{result.title}</Link></h3>
                  <p className="text-sm leading-relaxed break-words text-zinc-600 dark:text-zinc-400">{result.excerpt}</p>
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label={t("pagination")} className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-5 dark:border-zinc-800">
              {page > 1 ? <Link href={{ pathname: "/search", query: { q: query, page: page - 1 } }} className="text-accent hover:underline">{t("previous")}</Link> : <span />}
              <span className="text-sm">{t("page", { page, pages })}</span>
              {page < pages ? <Link href={{ pathname: "/search", query: { q: query, page: page + 1 } }} className="text-accent hover:underline">{t("next")}</Link> : <span />}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
