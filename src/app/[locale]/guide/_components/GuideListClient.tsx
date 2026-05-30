"use client";

import Link from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import type { GuideDoc } from "@/lib/types";
import { stripMarkdown, truncate } from "@/lib/utils";

export function GuideListClient({ guides }: { guides: GuideDoc[] }) {
  const t = useTranslations("GuideList");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  // Multi-select tag filter with OR semantics: clicking 2 tags shows
  // guides that match either one.
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // Aggregate tag → count from the full list so the chip bar reflects
  // every published guide, not just the currently-filtered subset.
  // Defensive `?? []` covers older docs (or docs created via console /
  // scripts) that pre-date the `tags` field; TypeScript's `string[]`
  // contract holds for everything our own code writes.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of guides) {
      for (const t of g.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0], locale),
    );
  }, [guides, locale]);

  // Pre-build a lowercased haystack per guide once. Running `.toLowerCase()`
  // on every guide's full body on every keystroke would be a lot of
  // wasted work at 200 entries × multi-KB bodies; do it once and reuse.
  const haystacks = useMemo(
    () =>
      guides.map((g) =>
        `${g.title}\n${(g.tags ?? []).join(" ")}\n${g.body}`.toLowerCase(),
      ),
    [guides],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guides.filter((g, i) => {
      const tags = g.tags ?? [];
      if (selectedTags.size > 0) {
        const hit = tags.some((t) => selectedTags.has(t));
        if (!hit) return false;
      }
      if (!q) return true;
      return haystacks[i].includes(q);
    });
  }, [guides, haystacks, query, selectedTags]);

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  function clearTags() {
    setSelectedTags(new Set());
  }

  return (
    <div className="space-y-4">
      <input
        type="search"
        aria-label={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />

      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {allTags.map(([tag, count]) => {
            const on = selectedTags.has(tag);
            return (
              <button
                key={tag}
                type="button"
                aria-pressed={on}
                onClick={() => toggleTag(tag)}
                className={
                  on
                    ? "rounded-full bg-zinc-900 px-2.5 py-0.5 text-xs text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }
              >
                {tag}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            );
          })}
          {selectedTags.size > 0 && (
            <button
              type="button"
              onClick={clearTags}
              className="ml-1 text-xs text-zinc-500 hover:underline"
            >
              {t("clearTags")}
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {guides.length === 0 ? t("empty") : t("noMatches")}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((g, i) => {
            const tags = g.tags ?? [];
            return (
              <FadeUp key={g.id} as="li" delay={i} className="block">
                <Link href={`/guide/${g.slug}`} className={`${interactiveCardClass} block p-5`}>
                  <h2 className="text-lg font-semibold">{g.title}</h2>
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.map((t) => (
                        <span
                          key={t}
                          className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                    {truncate(stripMarkdown(g.body), 140)}
                  </p>
                </Link>
              </FadeUp>
            );
          })}
        </ul>
      )}

      <p className="text-xs text-zinc-500">
        {t("showing", { filtered: filtered.length, total: guides.length })}
      </p>
    </div>
  );
}
