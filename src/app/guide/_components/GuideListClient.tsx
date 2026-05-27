"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { GuideDoc } from "@/lib/types";

// Lightweight Markdown→plain-text strip for one-line excerpts. We're not
// trying to be a full parser — just enough to keep code fences, image
// syntax, and link brackets out of the card preview. Anything we miss
// shows up as raw markdown which is mildly ugly but never wrong.
function makeExcerpt(body: string, max = 140): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`[^`]*`/g, " ") // inline code
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1") // links → just the text
    .replace(/^#+\s+/gm, "") // headings
    .replace(/[*_~]/g, "") // emphasis markers
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  // Truncate on a word boundary to avoid mid-word cuts (CJK has no spaces
  // so we still hard-truncate for those — `lastIndexOf(" ")` returns -1
  // and we fall back to the raw slice).
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut) + "…";
}

export function GuideListClient({ guides }: { guides: GuideDoc[] }) {
  const [query, setQuery] = useState("");
  // Multi-select tag filter with OR semantics: clicking 2 tags shows
  // guides that match either one.
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // Aggregate tag → count from the full list so the chip bar reflects
  // every published guide, not just the currently-filtered subset.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of guides) {
      for (const t of g.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) =>
      b[1] !== a[1] ? b[1] - a[1] : a[0].localeCompare(b[0], "ja"),
    );
  }, [guides]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guides.filter((g) => {
      if (selectedTags.size > 0) {
        const hit = g.tags.some((t) => selectedTags.has(t));
        if (!hit) return false;
      }
      if (!q) return true;
      // Search across title + tags + body. Keep it `.includes` for now —
      // good enough at the foreseeable list size; swap in fuse.js if we
      // grow past a few hundred entries and need fuzzy matching.
      const hay = `${g.title}\n${g.tags.join(" ")}\n${g.body}`.toLowerCase();
      return hay.includes(q);
    });
  }, [guides, query, selectedTags]);

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
        aria-label="ガイドを検索"
        placeholder="キーワードで検索（タイトル・タグ・本文）"
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
              タグをクリア
            </button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {guides.length === 0
            ? "まだ公開済みのガイドはありません。"
            : "条件に一致するガイドがありません。"}
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((g) => (
            <li
              key={g.id}
              className="rounded-lg border border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <Link href={`/guide/${g.slug}`} className="block p-5">
                <h2 className="text-lg font-semibold">{g.title}</h2>
                {g.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {g.tags.map((t) => (
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
                  {makeExcerpt(g.body)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-zinc-500">
        表示中: {filtered.length} / 全 {guides.length} 件
      </p>
    </div>
  );
}
