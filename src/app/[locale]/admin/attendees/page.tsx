import { getLocale, getTranslations } from "next-intl/server";

import { LoadErrorBanner } from "@/app/[locale]/admin/_components/LoadErrorBanner";
import { getSessionUser } from "@/lib/auth/session";
import { getEventById, listEventsForAdmin } from "@/lib/data/events";
import { listRsvps } from "@/lib/data/rsvps";
import { safeLoad } from "@/lib/data/safe-load";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import { formatDateTime } from "@/lib/utils";
import type { RsvpDoc, SurveyField } from "@/lib/types";

import { AttendanceToggle } from "./_components/AttendanceToggle";
import { AttendeeExportBar } from "./_components/AttendeeExportBar";
import { RsvpStatusSelect } from "./_components/RsvpStatusSelect";

export const dynamic = "force-dynamic";

function formatResponse(
  value: string | string[] | boolean | undefined,
  yes: string,
  no: string,
): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? yes : no;
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
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [locale, t, common] = await Promise.all([
    getLocale(),
    getTranslations("Admin.attendees"),
    getTranslations("Admin.common"),
  ]);

  const { eventId } = await searchParams;
  const eventsRes = await safeLoad("events", () =>
    listEventsForAdmin({
      statuses: ["draft", "published", "past"],
      limit: 50,
    }),
  );
  const events = eventsRes.ok ? eventsRes.data : [];
  const selectedId = eventId || events[0]?.id;
  const listedSelectedEvent = events.find((e) => e.id === selectedId);
  const selectedEventRes =
    selectedId && !listedSelectedEvent
      ? await safeLoad("event", () => getEventById(selectedId))
      : null;
  const selectedEvent =
    listedSelectedEvent ??
    (selectedEventRes?.ok ? selectedEventRes.data ?? undefined : undefined);
  const selectableEvents =
    selectedEvent && !events.some((e) => e.id === selectedEvent.id)
      ? [selectedEvent, ...events]
      : events;
  const surveyFields = selectedEvent?.surveyFields ?? [];
  // `null` when no event is selected — that's "nothing to load", not a
  // failure, so it must not trip the banner.
  const rsvpsRes = selectedId
    ? await safeLoad("RSVPs", () => listRsvps(selectedId))
    : null;
  const rsvps = rsvpsRes?.ok ? rsvpsRes.data : [];
  const loadFailed =
    !eventsRes.ok || selectedEventRes?.ok === false || rsvpsRes?.ok === false;

  return (
    <div className="space-y-6">
      <LoadErrorBanner show={loadFailed} />
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <form method="get" className="flex items-center gap-2">
        <label className="text-sm" htmlFor="eventId">
          {t("eventLabel")}
        </label>
        <select
          id="eventId"
          name="eventId"
          defaultValue={selectedId}
          className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          {selectedId && !selectedEvent && (
            <option value={selectedId}>{selectedId}</option>
          )}
          {selectableEvents.map((e) => {
            const start =
              formatDateTime(e.startAt, locale) || common("notAvailable");

            return (
              <option key={e.id} value={e.id}>
                {e.title} ({start})
              </option>
            );
          })}
        </select>
        <button
          type="submit"
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
        >
          {t("show")}
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
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-2">{t("columns.name")}</th>
              <th className="py-2">{t("columns.affiliation")}</th>
              <th className="py-2">{t("columns.email")}</th>
              <th className="py-2">{t("columns.role")}</th>
              <th className="py-2">{t("columns.status")}</th>
              <th className="py-2">{t("columns.attendance")}</th>
              <th className="py-2">{t("columns.details")}</th>
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
                        {common("guest")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-zinc-500">{r.affiliation || "—"}</td>
                  <td className="py-2 text-zinc-500">{r.email}</td>
                  <td className="py-2">
                    {r.role === "presenter" ? t("role.presenter") : t("role.attendee")}
                  </td>
                  <td className="py-2">
                    {selectedId ? (
                      <RsvpStatusSelect
                        key={`${selectedId}-${r.uid}-${r.status}`}
                        eventId={selectedId}
                        rsvpUid={r.uid}
                        initialStatus={r.status}
                      />
                    ) : (
                      t(`status.${r.status}`)
                    )}
                  </td>
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
                          {common("show")}
                        </summary>
                        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
                          {r.role === "presenter" && r.presentationTitle && (
                            <>
                              <dt className="font-medium text-zinc-500">
                                {t("presentationTitle")}
                              </dt>
                              <dd className="whitespace-pre-wrap">
                                {r.presentationTitle}
                              </dd>
                            </>
                          )}
                          {r.role === "presenter" && r.presentationAbstract && (
                            <>
                              <dt className="font-medium text-zinc-500">
                                {t("presentationAbstract")}
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
                                    {t("presenterOnly")}
                                  </span>
                                )}
                              </dt>
                              <dd className="whitespace-pre-wrap">
                                {formatResponse(
                                  r.surveyResponses?.[f.key],
                                  common("yes"),
                                  common("no"),
                                )}
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
