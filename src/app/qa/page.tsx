import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { getSessionUser } from "@/lib/auth/session";
import { listQa } from "@/lib/data/qa";
import { getPublicProfilesByUids } from "@/lib/data/users";
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
  const authorProfiles = await getPublicProfilesByUids(
    items.map((q) => q.authorUid),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-8">
      {/* Stack on mobile — same rationale as /blog and /guide: the
          subtitle gets cramped next to the CTA otherwise. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Q&amp;A</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            気軽に質問やTipsを投稿しましょう。コメント・返信・いいねで反応できます。
          </p>
        </div>
        {user ? (
          <Link
            href="/qa/new"
            className="w-fit shrink-0 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            投稿する
          </Link>
        ) : (
          <Link
            href="/login?redirect=/qa/new"
            className="w-fit shrink-0 rounded-full border border-zinc-300/70 px-5 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700/70 dark:hover:bg-zinc-800"
          >
            ログインして投稿
          </Link>
        )}
      </header>

      {items.length === 0 ? (
        <EmptyState
          message="まだ投稿はありません。"
          hint="最初の質問を投稿してみましょう。"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((q, i) => (
            <FadeUp
              key={q.id}
              as="li"
              delay={i}
              className={`${interactiveCardClass} relative flex flex-col p-5 focus-within:ring-2 focus-within:ring-indigo-500`}
            >
              <h2 className="text-lg font-semibold">
                {/* Stretched-link pattern: the title is the only real
                    link to /qa/[slug], but its ::after pseudo-element
                    covers the whole card so clicking anywhere outside
                    a nested interactive element still navigates. */}
                <Link
                  href={`/qa/${q.slug}`}
                  className="after:absolute after:inset-0 focus:outline-none"
                >
                  {q.title}
                </Link>
              </h2>
              <p className="relative z-10 mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                <AuthorBadge profile={authorProfiles.get(q.authorUid) ?? null} />
                <span>· {formatDate(q.createdAt)}</span>
                {(q.likeCount ?? 0) > 0 && (
                  <span className="ml-2 text-rose-600">♥ {q.likeCount}</span>
                )}
              </p>
              <p className="mt-2 line-clamp-3 text-sm text-zinc-700 dark:text-zinc-300">
                {truncate(stripMarkdown(q.body), 200)}
              </p>
              {q.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
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
            </FadeUp>
          ))}
        </ul>
      )}
    </div>
  );
}
