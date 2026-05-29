import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { listPublishedPosts } from "@/lib/data/posts";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "ブログ" };

export default async function BlogIndexPage() {
  const posts = await listPublishedPosts(50).catch(() => []);
  // Single batched read for every author appearing in the list — keeps
  // the page to one Firestore round-trip for user lookups regardless of
  // post count. AuthorBadge handles the missing-profile case (deleted
  // user) by rendering a plain @unknown placeholder.
  const authorProfiles = await getPublicProfilesByUids(
    posts.map((p) => p.authorUid),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">ブログ</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            JTPAコミュニティのメンバーによる記事
          </p>
        </div>
        <Link
          href="/blog/new"
          className="shrink-0 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          記事を投稿
        </Link>
      </header>

      {posts.length === 0 ? (
        <EmptyState
          message="まだ公開済みの記事はありません。"
          hint="最初の記事を投稿してみましょう。"
        />
      ) : (
        <ul className="space-y-4">
          {posts.map((p, i) => (
            <FadeUp
              key={p.id}
              as="li"
              delay={i}
              className={`${interactiveCardClass} group relative flex flex-col overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 sm:flex-row`}
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
                <h2 className="text-lg font-semibold">
                  <Link
                    href={`/blog/${p.slug}`}
                    className="after:absolute after:inset-0 focus:outline-none"
                  >
                    {p.title}
                  </Link>
                </h2>
                <p className="relative z-10 mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                  <AuthorBadge profile={authorProfiles.get(p.authorUid) ?? null} />
                  {p.publishedAt && <span>· {formatDate(p.publishedAt)}</span>}
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
            </FadeUp>
          ))}
        </ul>
      )}
    </div>
  );
}
