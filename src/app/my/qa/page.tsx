import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { listMyQa } from "@/lib/data/qa";
import { formatDate, stripMarkdown, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "自分のQ&A" };

export default async function MyQaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/my/qa");

  const items = await listMyQa(user.uid).catch((err) => {
    console.error("Failed to list my Q&A:", err);
    return [];
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-bold">自分のQ&amp;A</h1>
        <Link
          href="/qa/new"
          className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          新規投稿
        </Link>
      </header>

      {items.length === 0 ? (
        <p className="text-zinc-500">まだ投稿はありません。</p>
      ) : (
        <ul className="space-y-3">
          {items.map((q) => (
            <li
              key={q.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex items-start justify-between gap-3">
                <Link href={`/qa/${q.slug}`} className="font-semibold hover:underline">
                  {q.title}
                </Link>
                {q.status === "archived" && (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    アーカイブ済
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                最終更新: {formatDate(q.updatedAt)}
              </p>
              <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
                {truncate(stripMarkdown(q.body), 200)}
              </p>
              <div className="mt-2 flex gap-3 text-xs">
                <Link
                  href={`/qa/${q.slug}/edit`}
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
