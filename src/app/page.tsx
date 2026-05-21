import Link from "next/link";

import { listEvents } from "@/lib/data/events";
import { listProjects } from "@/lib/data/projects";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [events, projects] = await Promise.all([
    listEvents({ limit: 3, futureOnly: true }).catch(() => []),
    listProjects({ limit: 6 }).catch(() => []),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 space-y-16">
      <section className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          AIで集まる、つくる、共有する。
        </h1>
        <p className="max-w-2xl text-lg text-zinc-600 dark:text-zinc-300">
          JTPAは、Bay AreaのテックコミュニティでAI関連のイベント運営・知識共有を行っています。
          オンライン/オフラインのイベント、メンバーが作ったAIプロジェクトのショーケースをお楽しみください。
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/events"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            イベント一覧
          </Link>
          <Link
            href="/showcase"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ショーケースを見る
          </Link>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">直近のイベント</h2>
          <Link href="/events" className="text-sm text-blue-600 hover:underline">
            すべて見る →
          </Link>
        </div>
        {events.length === 0 ? (
          <p className="text-zinc-500">現在公開中のイベントはありません。</p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/events/${e.slug}`}
                  className="block h-full rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
                >
                  <p className="text-xs uppercase tracking-wide text-zinc-500">
                    {formatDateTime(e.startAt)}
                  </p>
                  <h3 className="mt-1 line-clamp-2 text-lg font-semibold">
                    {e.title}
                  </h3>
                  <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                    {e.description}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">注目のプロジェクト</h2>
          <Link href="/showcase" className="text-sm text-blue-600 hover:underline">
            すべて見る →
          </Link>
        </div>
        {projects.length === 0 ? (
          <p className="text-zinc-500">
            掲載中のプロジェクトはありません。あなたのAIプロジェクトを{" "}
            <Link href="/projects/new" className="text-blue-600 underline">
              投稿
            </Link>
            してみませんか？
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/showcase/${p.slug}`}
                  className="block h-full rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
                >
                  <h3 className="line-clamp-2 text-lg font-semibold">{p.title}</h3>
                  <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                    {p.description}
                  </p>
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
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
