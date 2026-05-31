"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { EmptyState } from "@/components/ui/EmptyState";
import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import Link from "@/i18n/navigation";

type CommunityKind = "guide" | "qa" | "poll" | "blog";
type CommunityFilter = "all" | CommunityKind;

type AuthorProfile = {
  uid: string;
  username: string;
  fullName: string | null;
  photoURL: string | null;
  affiliation: string | null;
  bio: string | null;
  links: {
    portfolio?: string;
    github?: string;
    linkedin?: string;
    sns?: string;
  };
  role: "admin" | "editor" | "contributor" | null;
};

export interface CommunityFeedItem {
  id: string;
  kind: CommunityKind;
  href: string;
  title: string;
  excerpt: string;
  tags: string[];
  dateLabel: string;
  sortTime: number;
  authorProfile: AuthorProfile | null;
  likeCount?: number;
  voterCount?: number;
  optionCount?: number;
}

const FILTERS: CommunityFilter[] = ["all", "guide", "qa", "poll", "blog"];

export function CommunityFeed({ items }: { items: CommunityFeedItem[] }) {
  const t = useTranslations("CommunityPage");
  const [filter, setFilter] = useState<CommunityFilter>("all");

  const counts = useMemo(() => {
    const next: Record<CommunityFilter, number> = {
      all: items.length,
      guide: 0,
      qa: 0,
      poll: 0,
      blog: 0,
    };
    for (const item of items) next[item.kind] += 1;
    return next;
  }, [items]);

  const visibleItems = useMemo(
    () => items.filter((item) => filter === "all" || item.kind === filter),
    [filter, items],
  );

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label={t("filtersLabel")}
          className="flex w-full gap-1 overflow-x-auto rounded-full border border-zinc-200 bg-zinc-50 p-1 text-sm sm:w-fit dark:border-zinc-800 dark:bg-zinc-900"
        >
          {FILTERS.map((item) => {
            const active = item === filter;
            return (
              <button
                key={item}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(item)}
                className={`shrink-0 rounded-full px-3 py-1.5 font-medium transition ${
                  active
                    ? "bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white"
                    : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
                }`}
              >
                {t(`filters.${item}`)}
                <span className="ml-1 text-xs text-zinc-400">
                  {counts[item]}
                </span>
              </button>
            );
          })}
        </div>
        <p className="text-sm text-zinc-500">
          {t("showing", {
            filtered: visibleItems.length,
            total: items.length,
          })}
        </p>
      </div>

      {items.length === 0 ? (
        <EmptyState message={t("empty")} hint={t("emptyHint")} />
      ) : visibleItems.length === 0 ? (
        <EmptyState message={t("noMatches")} />
      ) : (
        <ul className="space-y-3">
          {visibleItems.map((item, index) => (
            <FadeUp
              key={`${item.kind}-${item.id}`}
              as="li"
              delay={index}
              className={`${interactiveCardClass} relative flex flex-col p-5 focus-within:ring-2 focus-within:ring-indigo-500`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={kindPillClass(item.kind)}>
                  {t(`kind.${item.kind}`)}
                </span>
                <p className="relative z-10 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                  <Byline item={item} />
                  {item.dateLabel && <span>· {item.dateLabel}</span>}
                  {(item.likeCount ?? 0) > 0 && (
                    <span className="ml-2 text-rose-600">♥ {item.likeCount}</span>
                  )}
                  {item.kind === "poll" && (
                    <span className="ml-2">
                      {t("pollMeta", {
                        voters: item.voterCount ?? 0,
                        options: item.optionCount ?? 0,
                      })}
                    </span>
                  )}
                </p>
              </div>

              <h2 className="mt-2 text-lg font-semibold">
                <Link
                  href={item.href}
                  className="after:absolute after:inset-0 focus:outline-none"
                >
                  {item.title}
                </Link>
              </h2>
              {item.excerpt && (
                <p className="mt-2 line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">
                  {item.excerpt}
                </p>
              )}
              {item.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {item.tags.slice(0, 5).map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </FadeUp>
          ))}
        </ul>
      )}
    </section>
  );
}

function Byline({ item }: { item: CommunityFeedItem }) {
  return <AuthorBadge profile={item.authorProfile} />;
}

function kindPillClass(kind: CommunityKind) {
  const base = "rounded-full border px-2 py-0.5 text-xs font-medium";
  if (kind === "guide") {
    return `${base} border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300`;
  }
  if (kind === "qa") {
    return `${base} border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300`;
  }
  if (kind === "poll") {
    return `${base} border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300`;
  }
  return `${base} border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300`;
}
