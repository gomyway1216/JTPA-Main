import Link from "next/link";

import { listGuides } from "@/lib/data/guides";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminGuidesPage() {
  // Intentionally not catching: Firestore raises a helpful "create this
  // composite index" error here, and swallowing it would hide why guides
  // fail to load. Let it bubble up to Next.js's error boundary.
  const guides = await listGuides({
    statuses: ["draft", "published"],
    limit: 200,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ガイド管理</h1>
        <Link
          href="/admin/guides/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          新規作成
        </Link>
      </div>

      {guides.length === 0 ? (
        <p className="text-sm text-zinc-500">ガイドはまだありません。</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-2">タイトル</th>
              <th className="py-2">タグ</th>
              <th className="py-2">ステータス</th>
              <th className="py-2">順</th>
              <th className="py-2">更新</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {guides.map((g) => (
              <tr key={g.id}>
                <td className="py-2 font-medium">{g.title}</td>
                <td className="py-2 text-zinc-500">
                  {g.tags.length === 0 ? "—" : g.tags.join(", ")}
                </td>
                <td className="py-2">
                  {g.status === "published" ? (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                      公開
                    </span>
                  ) : (
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      下書き
                    </span>
                  )}
                </td>
                <td className="py-2 text-zinc-500">{g.order}</td>
                <td className="py-2 text-zinc-500">
                  {formatDateTime(g.updatedAt)}
                </td>
                <td className="py-2 text-right">
                  <Link
                    href={`/admin/guides/${g.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    編集
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
