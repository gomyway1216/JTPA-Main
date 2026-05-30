import Link from "@/i18n/navigation";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { parentRoutePrefix } from "@/lib/comments-parent";
import {
  fetchCommentParentMetas,
  listLikedCommentsByAuthor,
} from "@/lib/data/comments";
import type { CommentParentType } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "もらったいいね" };

const PARENT_LABEL: Record<CommentParentType, string> = {
  post: "ブログ",
  guide: "ガイド",
  qa: "Q&A",
  project: "ショーケース",
  poll: "投票",
};

export default async function MyLikesPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/my/likes");

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
        <h1 className="text-2xl font-bold">もらったいいね</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          いいねを受け取った自分のコメント
        </p>
      </header>

      {comments.length === 0 ? (
        <p className="text-zinc-500">
          まだいいねを受け取ったコメントはありません。
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
                      {PARENT_LABEL[c.parentType]} ·{" "}
                      {parentHref ? (
                        <Link
                          href={parentHref}
                          className="text-blue-600 hover:underline"
                        >
                          {meta?.title}
                        </Link>
                      ) : (
                        <span className="italic">削除されたページ</span>
                      )}
                    </p>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                      {c.body}
                    </p>
                    <p className="mt-2 text-xs text-zinc-500">
                      {formatDateTime(c.createdAt)}
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
