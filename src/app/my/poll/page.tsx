import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { listMyPoll } from "@/lib/data/poll";
import { formatDate, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "自分の投票" };

export default async function MyPollPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/my/poll");

  const items = await listMyPoll(user.uid).catch((err) => {
    console.error("Failed to list my polls:", err);
    return [];
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-bold">自分の投票</h1>
        <Link
          href="/poll/new"
          className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          新規作成
        </Link>
      </header>

      {items.length === 0 ? (
        <p className="text-zinc-500">まだ投票はありません。</p>
      ) : (
        <ul className="space-y-3">
          {items.map((p) => (
            <li
              key={p.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <Link href={`/poll/${p.slug}`} className="font-semibold hover:underline">
                  {p.title}
                </Link>
                {p.status === "archived" && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    アーカイブ済
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                最終更新: {formatDate(p.updatedAt)} · {p.voterCount ?? 0} 人が投票
              </p>
              {p.description && (
                <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                  {truncate(p.description, 200)}
                </p>
              )}
              <div className="mt-2 flex gap-3 text-xs">
                <Link
                  href={`/poll/${p.slug}/edit`}
                  className="text-blue-600 hover:underline"
                >
                  編集
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
