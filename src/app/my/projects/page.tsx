import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { listMyProjects } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  pending: {
    label: "審査中",
    cls: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  approved: {
    label: "公開中",
    cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  },
  rejected: {
    label: "却下",
    cls: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  },
  archived: {
    label: "アーカイブ",
    cls: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  },
};

export default async function MyProjectsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/my/projects");

  const projects = await listMyProjects(user.uid).catch(() => []);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">自分の投稿</h1>
        <Link
          href="/projects/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          新規投稿
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-zinc-500">まだ投稿はありません。</p>
      ) : (
        <ul className="space-y-3">
          {projects.map((p) => {
            const meta = STATUS_LABELS[p.status] ?? STATUS_LABELS.pending;
            return (
              <li
                key={p.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{p.title}</h2>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {p.description}
                    </p>
                    {p.status === "rejected" && p.reviewNote && (
                      <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                        コメント: {p.reviewNote}
                      </p>
                    )}
                  </div>
                  <span
                    className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${meta.cls}`}
                  >
                    {meta.label}
                  </span>
                </div>
                <div className="mt-3 flex gap-3 text-sm">
                  <Link
                    href={`/my/projects/${p.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    編集
                  </Link>
                  {p.status === "approved" && (
                    <Link
                      href={`/showcase/${p.slug}`}
                      className="text-blue-600 hover:underline"
                    >
                      公開ページを見る
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
