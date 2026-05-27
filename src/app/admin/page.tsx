import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { listEvents } from "@/lib/data/events";
import { listProjects } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) redirect("/admin/guides");

  const [pending, upcoming] = await Promise.all([
    listProjects({ status: "pending", limit: 5 }).catch(() => []),
    listEvents({ statuses: ["draft", "published"], limit: 5 }).catch(() => []),
  ]);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">管理ダッシュボード</h1>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">承認待ちのプロジェクト ({pending.length})</h2>
          <Link href="/admin/projects" className="text-sm text-blue-600 hover:underline">
            すべて見る →
          </Link>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-500 mt-2">承認待ちはありません。</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {pending.map((p) => (
              <li key={p.id} className="py-2">
                <Link
                  href={`/admin/projects`}
                  className="flex items-center justify-between gap-3 text-sm hover:underline"
                >
                  <span>{p.title}</span>
                  <span className="text-xs text-zinc-500">{p.ownerName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">イベント ({upcoming.length})</h2>
          <Link href="/admin/events" className="text-sm text-blue-600 hover:underline">
            管理 →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-zinc-500 mt-2">イベントはありません。</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {upcoming.map((e) => (
              <li key={e.id} className="py-2">
                <Link
                  href={`/admin/events/${e.id}/edit`}
                  className="flex items-center justify-between gap-3 text-sm hover:underline"
                >
                  <span>{e.title}</span>
                  <span className="text-xs text-zinc-500">{e.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
