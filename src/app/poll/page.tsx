import Link from "next/link";

import { EmptyState } from "@/components/ui/EmptyState";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { getSessionUser } from "@/lib/auth/session";
import { listPoll } from "@/lib/data/poll";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { formatDate, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "投票",
  description: "JTPAコミュニティの投票・アンケート",
};

export default async function PollListPage() {
  const [user, items] = await Promise.all([
    getSessionUser(),
    listPoll({ statuses: ["published"], limit: 50 }).catch((err) => {
      console.error("Failed to list polls:", err);
      return [];
    }),
  ]);
  const authorProfiles = await getPublicProfilesByUids(
    items.map((p) => p.authorUid),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">投票</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            みんなの「どっち派？」を集計します。複数選択OK・いつでも変更できます。
          </p>
        </div>
        {user ? (
          <Link
            href="/poll/new"
            className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            投票を作成
          </Link>
        ) : (
          <Link
            href="/login?redirect=/poll/new"
            className="shrink-0 rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ログインして作成
          </Link>
        )}
      </header>

      {items.length === 0 ? (
        <EmptyState
          message="まだ投票はありません。"
          hint="最初の投票を作ってみましょう。"
        />
      ) : (
        <ul className="space-y-3">
          {items.map((p) => {
            // Show the top 2 option labels in the list preview so the
            // reader can guess the topic without opening the detail.
            const topOptions = [...p.options]
              .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0))
              .slice(0, 2);
            return (
              <li
                key={p.id}
                className="group relative flex flex-col rounded-lg border border-zinc-200 bg-white p-4 transition focus-within:ring-2 focus-within:ring-blue-500 hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
              >
                <h2 className="text-lg font-semibold">
                  <Link
                    href={`/poll/${p.slug}`}
                    className="after:absolute after:inset-0 focus:outline-none"
                  >
                    {p.title}
                  </Link>
                </h2>
                <p className="relative z-10 mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                  <AuthorBadge profile={authorProfiles.get(p.authorUid) ?? null} />
                  <span>
                    · {formatDate(p.createdAt)} · {p.voterCount ?? 0} 人が投票
                  </span>
                  {(p.likeCount ?? 0) > 0 && (
                    <span className="ml-2 text-rose-600">♥ {p.likeCount}</span>
                  )}
                </p>
                {p.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {truncate(p.description, 160)}
                  </p>
                )}
                <p className="mt-2 text-xs text-zinc-500">
                  {p.options.length}つの選択肢
                  {topOptions.length > 0 && (
                    <> · {topOptions.map((o) => o.label).join(" / ")}…</>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
