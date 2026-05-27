import Link from "next/link";
import { notFound } from "next/navigation";

import { getProjectBySlug } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.status !== "approved") notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{project.title}</h1>
        <p className="text-sm text-zinc-500">投稿者: {project.ownerName}</p>
        {project.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {project.tags.map((t) => (
              <span
                key={t}
                className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      {project.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={project.thumbnail.url}
          alt={`${project.title} のカバー画像`}
          className="w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      <section className="prose-jtpa">{project.description}</section>

      {(project.screenshots?.length ?? 0) > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">スクリーンショット</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {project.screenshots?.map((s, i) => (
              <li key={s.path}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="block"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.url}
                    alt={`screenshot ${i + 1}`}
                    className="h-32 w-full rounded border border-zinc-200 object-cover hover:opacity-90 dark:border-zinc-800"
                  />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-3">
        <Link
          href={project.appUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          アプリを開く →
        </Link>
        {project.repoUrl && (
          <Link
            href={project.repoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            ソースコード
          </Link>
        )}
        {project.demoVideoUrl && (
          <Link
            href={project.demoVideoUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            デモ動画
          </Link>
        )}
      </div>
    </article>
  );
}
