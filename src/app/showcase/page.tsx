import Link from "next/link";

import { listProjects } from "@/lib/data/projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "ショーケース" };

export default async function ShowcasePage() {
  const projects = await listProjects({ limit: 100 }).catch(() => []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold">ショーケース</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            JTPAコミュニティのメンバーが作ったAIプロジェクト
          </p>
        </div>
        <Link
          href="/projects/new"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          プロジェクトを投稿
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-zinc-500">まだ承認済みプロジェクトはありません。</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/showcase/${p.slug}`}
                className="block h-full overflow-hidden rounded-lg border border-zinc-200 bg-white hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
              >
                {(p.thumbnail?.url || p.screenshots[0]?.url) && (
                  // Cover image. Falls back to the first screenshot when the
                  // submitter didn't upload a dedicated thumbnail.
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.thumbnail?.url || p.screenshots[0]?.url}
                    alt=""
                    className="h-40 w-full object-cover"
                  />
                )}
                <div className="p-5">
                  <h3 className="line-clamp-2 text-lg font-semibold">{p.title}</h3>
                  <p className="mt-1 text-xs text-zinc-500">by {p.ownerName}</p>
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
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
