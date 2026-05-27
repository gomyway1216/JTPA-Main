import Link from "next/link";

import { listPublishedPosts } from "@/lib/data/posts";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "ブログ" };

export default async function BlogIndexPage() {
  const posts = await listPublishedPosts(50).catch(() => []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">ブログ</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          JTPAコミュニティのメンバーによる記事
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="text-zinc-500">まだ公開済みの記事はありません。</p>
      ) : (
        <ul className="space-y-4">
          {posts.map((p) => (
            <li
              key={p.id}
              className="overflow-hidden rounded-lg border border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
            >
              <Link
                href={`/blog/${p.slug}`}
                className="flex flex-col gap-0 sm:flex-row"
              >
                {p.coverImage?.url && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.coverImage.url}
                    alt={`${p.title} のカバー画像`}
                    className="h-40 w-full object-cover sm:h-auto sm:w-48 sm:shrink-0"
                  />
                )}
                <div className="flex-1 p-5">
                  <h2 className="text-lg font-semibold">{p.title}</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    by {p.authorName}
                    {p.publishedAt && (
                      <>
                        {" · "}
                        {formatDate(p.publishedAt)}
                      </>
                    )}
                  </p>
                  {p.excerpt && (
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                      {p.excerpt}
                    </p>
                  )}
                  {p.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {p.tags.slice(0, 4).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
