import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { listEvents } from "@/lib/data/events";
import { listRsvps } from "@/lib/data/rsvps";
import { formatDateTime } from "@/lib/utils";
import type { RsvpDoc, SurveyField } from "@/lib/types";

import { AttendanceToggle } from "./_components/AttendanceToggle";
import { AttendeeExportBar } from "./_components/AttendeeExportBar";

export const dynamic = "force-dynamic";

function formatResponse(
  value: string | string[] | boolean | undefined,
): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "はい" : "いいえ";
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

function fieldsForRsvp(
  fields: SurveyField[],
  r: RsvpDoc,
): SurveyField[] {
  // Hide presenter-only questions for plain attendees (their answers should
  // be blank anyway, but it's cleaner to skip the rows entirely).
  return fields.filter(
    (f) => f.audience === "all" || r.role === "presenter",
  );
}

export default async function AdminAttendeesPage({
  searchParams,
}: {
  searchParams: Promise<{ eventId?: string }>;
}) {
  const user = await getSessionUser();
  if (!user?.isAdmin) redirect("/admin/guides");

  const { eventId } = await searchParams;
  const events = await listEvents({
    statuses: ["draft", "published", "past"],
    limit: 50,
  }).catch(() => []);
  const selectedId = eventId || events[0]?.id;
  const selectedEvent = events.find((e) => e.id === selectedId);
  const surveyFields = selectedEvent?.surveyFields ?? [];
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
          surveyFields={surveyFields}
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
              <th className="py-2">出席</th>
              <th className="py-2">詳細</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rsvps.map((r) => {
              const applicableFields = fieldsForRsvp(surveyFields, r);
              const hasDetails =
                applicableFields.length > 0 ||
                !!r.presentationTitle ||
                !!r.presentationAbstract;
              return (
                <tr key={r.uid} className="align-top">
                  <td className="py-2 font-medium">
                    {r.displayName}
                    {r.isGuest && (
                      <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        ゲスト
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-zinc-500">{r.affiliation || "—"}</td>
                  <td className="py-2 text-zinc-500">{r.email}</td>
                  <td className="py-2">
                    {r.role === "presenter" ? "発表者" : "参加者"}
                  </td>
                  <td className="py-2">{r.status}</td>
                  <td className="py-2">
                    {selectedId && (
                      // Key includes attendedAt so a server-side change
                      // (another admin's toggle, or self check-in) resets
                      // the local optimistic state on refresh, and so
                      // switching events doesn't reuse a stale instance
                      // for a uid that happens to RSVP for both events.
                      <AttendanceToggle
                        key={`${selectedId}-${r.uid}-${!!r.attendedAt}`}
                        eventId={selectedId}
                        rsvpUid={r.uid}
                        initialAttended={!!r.attendedAt}
                      />
                    )}
                  </td>
                  <td className="py-2">
                    {hasDetails ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-blue-600 hover:underline">
                          表示
                        </summary>
                        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                          {r.role === "presenter" && r.presentationTitle && (
                            <>
                              <dt className="font-medium text-zinc-500">
                                発表タイトル
                              </dt>
                              <dd className="whitespace-pre-wrap">
                                {r.presentationTitle}
                              </dd>
                            </>
                          )}
                          {r.role === "presenter" && r.presentationAbstract && (
                            <>
                              <dt className="font-medium text-zinc-500">
                                発表概要
                              </dt>
                              <dd className="whitespace-pre-wrap">
                                {r.presentationAbstract}
                              </dd>
                            </>
                          )}
                          {applicableFields.map((f) => (
                            <span key={f.key} className="contents">
                              <dt className="font-medium text-zinc-500">
                                {f.label}
                                {f.audience === "presenter" && (
                                  <span className="ml-1 text-[10px] text-zinc-400">
                                    (発表者のみ)
                                  </span>
                                )}
                              </dt>
                              <dd className="whitespace-pre-wrap">
                                {formatResponse(r.surveyResponses?.[f.key])}
                              </dd>
                            </span>
                          ))}
                        </dl>
                      </details>
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
