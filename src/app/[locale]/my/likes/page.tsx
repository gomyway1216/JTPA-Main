import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import {
  isParentPubliclyVisible,
  parentRoutePrefix,
} from "@/lib/comments-parent";
import {
  fetchCommentParentMetas,
  listLikedCommentsByAuthor,
} from "@/lib/data/comments";
import {
  listLikedRecordsByAuthor,
  type ReceivedRecordLike,
} from "@/lib/data/received-likes";
import { formatDateTime, toDate } from "@/lib/utils";
import type { CommentDoc, CommentParentType, TsLike } from "@/lib/types";

export const dynamic = "force-dynamic";

type LikeListItem =
  | {
      kind: "record";
      key: string;
      parentType: CommentParentType;
      href: string;
      title: string;
      likeCount: number;
      date?: TsLike;
    }
  | {
      kind: "comment";
      key: string;
      parentType: CommentParentType;
      href: string | null;
      title: string;
      body: string;
      likeCount: number;
      date?: TsLike;
    };

function itemTime(item: LikeListItem): number {
  return toDate(item.date)?.getTime() ?? 0;
}

function compareItems(a: LikeListItem, b: LikeListItem): number {
  return b.likeCount - a.likeCount || itemTime(b) - itemTime(a);
}

function recordEditHref(record: ReceivedRecordLike): string {
  switch (record.parentType) {
    case "post":
      return `/my/posts/${record.parentId}/edit`;
    case "guide":
      return `/my/guides/${record.parentId}/edit`;
    case "project":
      return `/my/projects/${record.parentId}/edit`;
    case "qa":
      return `/qa/${record.slug}/edit`;
    case "poll":
      return `/poll/${record.slug}/edit`;
  }
}

function recordHref(record: ReceivedRecordLike): string {
  if (
    record.status &&
    isParentPubliclyVisible(record.parentType, { status: record.status })
  ) {
    return `${parentRoutePrefix(record.parentType)}/${record.slug}`;
  }
  return recordEditHref(record);
}

function recordToItem(record: ReceivedRecordLike): LikeListItem {
  return {
    kind: "record",
    key: `record:${record.parentType}:${record.parentId}`,
    parentType: record.parentType,
    href: recordHref(record),
    title: record.title,
    likeCount: record.likeCount,
    date: record.updatedAt ?? record.createdAt,
  };
}

export async function generateMetadata() {
  const t = await getTranslations("MyLikes");
  return { title: t("metadataTitle") };
}

export default async function MyLikesPage() {
  const user = await getSessionUser();
  if (!user) {
    const locale = await getLocale();
    redirect(loginPath("/my/likes", locale));
  }

  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("MyLikes"),
  ]);

  // Missing composite indexes show up as Firestore errors with a one-click
  // "create index" link in the message — log so it's visible on first run.
  const [records, comments] = await Promise.all([
    listLikedRecordsByAuthor(user.uid).catch((err) => {
      console.error("Failed to list liked records:", err);
      return [];
    }),
    listLikedCommentsByAuthor(user.uid).catch((err) => {
      console.error("Failed to list liked comments:", err);
      return [];
    }),
  ]);

  const parents = await fetchCommentParentMetas(
    comments.map((c) => ({ parentType: c.parentType, parentId: c.parentId })),
  ).catch((err) => {
    console.error("Failed to fetch comment parent metas:", err);
    return new Map();
  });
  const items = [
    ...records.map(recordToItem),
    ...comments.map((c: CommentDoc): LikeListItem => {
      const meta = parents.get(`${c.parentType}:${c.parentId}`);
      return {
        kind: "comment",
        key: `comment:${c.parentType}:${c.parentId}:${c.id}`,
        parentType: c.parentType,
        href: meta ? `${parentRoutePrefix(c.parentType)}/${meta.slug}` : null,
        title: meta?.title ?? t("deletedPage"),
        body: c.body,
        likeCount: c.likeCount ?? 0,
        date: c.createdAt,
      };
    }),
  ].sort(compareItems);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t("description")}
        </p>
      </header>

      {items.length === 0 ? (
        <p className="text-zinc-500">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const date = formatDateTime(item.date, locale);
            return (
              <li
                key={item.key}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-500">
                      {t(`parent.${item.parentType}`)} ·{" "}
                      {item.kind === "comment"
                        ? t("commentLabel")
                        : t("recordLabel")}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">
                      {item.href ? (
                        <Link
                          href={item.href}
                          className="text-blue-600 hover:underline"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <span className="italic text-zinc-500">
                          {item.title}
                        </span>
                      )}
                    </p>
                    {item.kind === "comment" && (
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                        {item.body}
                      </p>
                    )}
                    {date && (
                      <p className="mt-2 text-xs text-zinc-500">{date}</p>
                    )}
                  </div>
                  <span className="whitespace-nowrap rounded bg-pink-100 px-2 py-1 text-xs font-medium text-pink-900 dark:bg-pink-950 dark:text-pink-200">
                    ♥ {item.likeCount}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
