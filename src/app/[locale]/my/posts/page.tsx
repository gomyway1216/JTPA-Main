import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { listMyGuides } from "@/lib/data/guides";
import { listMyPosts } from "@/lib/data/posts";
import { listMyPoll } from "@/lib/data/poll";
import { listMyQa } from "@/lib/data/qa";
import {
  getLocalizedGuideContent,
  getLocalizedPollContent,
  getLocalizedPostContent,
  getLocalizedQaContent,
} from "@/lib/localized-content";
import { formatDate, stripMarkdown, toDate, truncate } from "@/lib/utils";
import type { TsLike } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("MyPosts");
  return { title: t("metadataTitle") };
}

const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  pending:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  published:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  archived: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

type MyPostItem = {
  id: string;
  type: "post" | "guide" | "qa" | "poll";
  title: string;
  summary: string;
  status: string;
  updatedAt: TsLike;
  editHref: string;
  publicHref: string;
  reviewNote?: string;
};

function byUpdatedAtDesc(a: MyPostItem, b: MyPostItem): number {
  const aTime = toDate(a.updatedAt)?.getTime() ?? 0;
  const bTime = toDate(b.updatedAt)?.getTime() ?? 0;
  return bTime - aTime;
}

export default async function MyPostsPage() {
  const user = await getSessionUser();
  if (!user) {
    const locale = await getLocale();
    redirect(loginPath("/my/posts", locale));
  }

  const [locale, t, common, statusT] = await Promise.all([
    getLocale(),
    getTranslations("MyPosts"),
    getTranslations("MyCommon"),
    getTranslations("Status"),
  ]);

  // Surface unexpected errors to server logs. Missing composite indexes
  // (the most common cause of failure here) show up as Firestore errors
  // that include a one-click "create index" link in the message, but only
  // if we actually log them.
  const [posts, guides, qaItems, polls] = await Promise.all([
    listMyPosts(user.uid).catch((err) => {
      console.error("Failed to list my posts:", err);
      return [];
    }),
    listMyGuides(user.uid).catch((err) => {
      console.error("Failed to list my guides for my posts page:", err);
      return [];
    }),
    listMyQa(user.uid).catch((err) => {
      console.error("Failed to list my Q&A for my posts page:", err);
      return [];
    }),
    listMyPoll(user.uid).catch((err) => {
      console.error("Failed to list my polls for my posts page:", err);
      return [];
    }),
  ]);

  const items: MyPostItem[] = [
    ...posts.map((p): MyPostItem => {
      const content = getLocalizedPostContent(p, locale);
      return {
        id: `post-${p.id}`,
        type: "post",
        title: content.title,
        summary: content.excerpt,
        status: p.status,
        updatedAt: p.updatedAt,
        editHref: `/my/posts/${p.id}/edit`,
        publicHref: `/blog/${p.slug}`,
        reviewNote: p.reviewNote,
      };
    }),
    ...guides.map((g): MyPostItem => {
      const content = getLocalizedGuideContent(g, locale);
      return {
        id: `guide-${g.id}`,
        type: "guide",
        title: content.title,
        summary: truncate(stripMarkdown(content.body), 200),
        status: g.status,
        updatedAt: g.updatedAt,
        editHref: `/my/guides/${g.id}/edit`,
        publicHref: `/guide/${g.slug}`,
        reviewNote: g.reviewNote,
      };
    }),
    ...qaItems.map((q): MyPostItem => {
      const content = getLocalizedQaContent(q, locale);
      return {
        id: `qa-${q.id}`,
        type: "qa",
        title: content.title,
        summary: truncate(stripMarkdown(content.body), 200),
        status: q.status,
        updatedAt: q.updatedAt,
        editHref: `/qa/${q.slug}/edit`,
        publicHref: `/qa/${q.slug}`,
      };
    }),
    ...polls.map((p): MyPostItem => {
      const content = getLocalizedPollContent(p, locale);
      return {
        id: `poll-${p.id}`,
        type: "poll",
        title: content.title,
        summary: truncate(content.description ?? "", 200),
        status: p.status,
        updatedAt: p.updatedAt,
        editHref: `/poll/${p.slug}/edit`,
        publicHref: `/poll/${p.slug}`,
      };
    }),
  ].sort(byUpdatedAtDesc);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/blog/new"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t("newArticle")}
          </Link>
          <Link
            href="/guide/new"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
          >
            {t("newGuide")}
          </Link>
          <Link
            href="/qa/new"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
          >
            {t("newQa")}
          </Link>
          <Link
            href="/poll/new"
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
          >
            {common("newPoll")}
          </Link>
        </div>
      </div>

      {items.length === 0 ? (
        <p className="text-zinc-500">{common("emptyPosts")}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const cls = STATUS_CLASSES[item.status] ?? STATUS_CLASSES.draft;
            return (
              <li
                key={item.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                        {t(`type.${item.type}`)}
                      </span>
                      <h2 className="text-lg font-semibold">{item.title}</h2>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {common("lastUpdated", {
                        date: formatDate(item.updatedAt, locale),
                      })}
                    </p>
                    {item.summary && (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                        {item.summary}
                      </p>
                    )}
                    {item.status === "rejected" && item.reviewNote && (
                      <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                        {common("reviewComment", {
                          comment: item.reviewNote,
                        })}
                      </p>
                    )}
                  </div>
                  <span
                    className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${cls}`}
                  >
                    {statusT(item.status)}
                  </span>
                </div>
                <div className="mt-3 flex gap-3 text-sm">
                  <Link
                    href={item.editHref}
                    className="text-blue-600 hover:underline"
                  >
                    {common("edit")}
                  </Link>
                  {item.status === "published" && (
                    <Link
                      href={item.publicHref}
                      className="text-blue-600 hover:underline"
                    >
                      {common("viewPublic")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
