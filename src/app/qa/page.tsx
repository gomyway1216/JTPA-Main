import Link from "next/link";

import { AuthorBadge } from "@/components/users/AuthorBadge";
import { getSessionUser } from "@/lib/auth/session";
import { listQa } from "@/lib/data/qa";
import { formatDate, stripMarkdown, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Q&A",
  description: "JTPAコミュニティの質問・Tips投稿",
};

export default async function QaListPage() {
  const [user, items] = await Promise.all([
    getSessionUser(),
    listQa({ statuses: ["published"], limit: 50 }).catch((err) => {
      console.error("Failed to list Q&A:", err);
      return [];
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Q&amp;A</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            気軽に質問やTipsを投稿しましょう。コメント・返信・いいねで反応できます。
          </p>
        </div>
        {user ? (
          <Link
            href="/qa/new"
            className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            投稿する
          </Link>
        ) : (
          <Link
            href="/login?redirect=/qa/new"
            className="shrink-0 rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ログインして投稿
          </Link>
        )}
      </header>

      {items.length === 0 ? (
        <p className="text-zinc-500">まだ投稿はありません。最初の質問を投稿してみましょう！</p>
      ) : (
        <ul className="space-y-3">
          {items.map((q) => (
            <li
              key={q.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Link href={`/qa/${q.slug}`} className="block hover:underline">
                <h2 className="text-lg font-semibold">{q.title}</h2>
              </Link>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                <AuthorBadge
                  name={q.authorName}
                  photoURL={q.authorPhotoURL}
                  uid={q.authorUid}
                />
                <span>· {formatDate(q.createdAt)}</span>
                {(q.likeCount ?? 0) > 0 && (
                  <span className="ml-2 text-rose-600">♥ {q.likeCount}</span>
                )}
              </p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {truncate(stripMarkdown(q.body), 200)}
              </p>
              {q.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {q.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
