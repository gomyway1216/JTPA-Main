import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { parentRoutePrefix } from "@/lib/comments-parent";
import {
  fetchCommentParentMetas,
  listLikedCommentsByAuthor,
} from "@/lib/data/comments";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

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
  const comments = await listLikedCommentsByAuthor(user.uid).catch((err) => {
    console.error("Failed to list liked comments:", err);
    return [];
  });

  const parents = await fetchCommentParentMetas(
    comments.map((c) => ({ parentType: c.parentType, parentId: c.parentId })),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t("description")}
        </p>
      </header>

      {comments.length === 0 ? (
        <p className="text-zinc-500">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => {
            const meta = parents.get(`${c.parentType}:${c.parentId}`);
            const parentHref = meta
              ? `${parentRoutePrefix(c.parentType)}/${meta.slug}`
              : null;
            return (
              <li
                key={c.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-500">
                      {t(`parent.${c.parentType}`)} ·{" "}
                      {parentHref ? (
                        <Link
                          href={parentHref}
                          className="text-blue-600 hover:underline"
                        >
                          {meta?.title}
                        </Link>
                      ) : (
                        <span className="italic">{t("deletedPage")}</span>
                      )}
                    </p>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                      {c.body}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {formatDateTime(c.createdAt, locale)}
                    </p>
                  </div>
                  <span className="whitespace-nowrap rounded bg-pink-100 px-2 py-1 text-xs font-medium text-pink-900 dark:bg-pink-950 dark:text-pink-200">
                    ♥ {c.likeCount ?? 0}
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
