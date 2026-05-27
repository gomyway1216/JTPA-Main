import Link from "next/link";
import { redirect } from "next/navigation";

import { CloneEventButton } from "@/app/admin/events/_components/CloneEventButton";
import { getSessionUser } from "@/lib/auth/session";
import { listEvents } from "@/lib/data/events";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) redirect("/admin/guides");

  const events = await listEvents({
    statuses: ["draft", "published", "past", "cancelled"],
    limit: 100,
  }).catch(() => []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">イベント管理</h1>
        <Link
          href="/admin/events/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          新規作成
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-zinc-500">イベントはまだありません。</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-2">タイトル</th>
              <th className="py-2">開始</th>
              <th className="py-2">ステータス</th>
              <th className="py-2">RSVP</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {events.map((e) => (
              <tr key={e.id}>
                <td className="py-2 font-medium">
                  {e.title}
                  {e.visibility === "members_only" && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      メンバー限定
                    </span>
                  )}
                </td>
                <td className="py-2 text-zinc-500">{formatDateTime(e.startAt)}</td>
                <td className="py-2">{e.status}</td>
                <td className="py-2">
                  {e.rsvpCount}
                  {e.capacity > 0 ? ` / ${e.capacity}` : ""}
                </td>
                <td className="py-2 text-right">
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      href={`/admin/events/${e.id}/edit`}
                      className="text-blue-600 hover:underline"
                    >
                      編集
                    </Link>
                    <CloneEventButton eventId={e.id} eventTitle={e.title} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
