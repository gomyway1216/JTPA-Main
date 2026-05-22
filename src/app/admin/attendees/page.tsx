import { AttendeeExportBar } from "@/app/admin/attendees/_components/AttendeeExportBar";
import { listEvents } from "@/lib/data/events";
import { listRsvps } from "@/lib/data/rsvps";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminAttendeesPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const { eventId } = await searchParams;
  const events = await listEvents({
    statuses: ["draft", "published", "past"],
    limit: 50,
  }).catch(() => []);
  const selectedId = eventId || events[0]?.id;
  const selectedEvent = events.find((e) => e.id === selectedId);
  const rsvps = selectedId
    ? await listRsvps(selectedId).catch(() => [])
    : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">参加者</h1>

      <form method="get" className="flex items-center gap-2">
        <label className="text-sm" htmlFor="eventId">
          イベント:
        </label>
        <select
          id="eventId"
          name="eventId"
          defaultValue={selectedId}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title} ({formatDateTime(e.startAt)})
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          表示
        </button>
      </form>

      {rsvps.length > 0 && (
        <AttendeeExportBar
          rsvps={rsvps}
          eventTitle={selectedEvent?.title ?? "attendees"}
        />
      )}

      {rsvps.length === 0 ? (
        <p className="text-sm text-zinc-500">参加者がいません。</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-2">名前</th>
              <th className="py-2">所属</th>
              <th className="py-2">メール</th>
              <th className="py-2">役割</th>
              <th className="py-2">ステータス</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rsvps.map((r) => (
              <tr key={r.uid}>
                <td className="py-2 font-medium">{r.displayName}</td>
                <td className="py-2 text-zinc-500">{r.affiliation || "—"}</td>
                <td className="py-2 text-zinc-500">{r.email}</td>
                <td className="py-2">
                  {r.role === "presenter" ? "発表者" : "参加者"}
                </td>
                <td className="py-2">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
