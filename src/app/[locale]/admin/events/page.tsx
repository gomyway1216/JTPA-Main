import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { LoadErrorBanner } from "@/app/[locale]/admin/_components/LoadErrorBanner";
import { CloneEventButton } from "@/app/[locale]/admin/events/_components/CloneEventButton";
import { getSessionUser } from "@/lib/auth/session";
import { listEventsForAdmin } from "@/lib/data/events";
import { safeLoad } from "@/lib/data/safe-load";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminEventsPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [locale, t, common] = await Promise.all([
    getLocale(),
    getTranslations("Admin.events"),
    getTranslations("Admin.common"),
  ]);

  const eventsRes = await safeLoad("events", () =>
    listEventsForAdmin(),
  );
  const events = eventsRes.ok ? eventsRes.data : [];

  return (
    <div className="space-y-4">
      <LoadErrorBanner show={!eventsRes.ok} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link
          href="/admin/events/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {common("createNew")}
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-2">{t("columns.title")}</th>
              <th className="py-2">{t("columns.start")}</th>
              <th className="py-2">{t("columns.status")}</th>
              <th className="py-2">{t("columns.rsvp")}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {events.map((e) => {
              const start =
                formatDateTime(e.startAt, locale) || common("notAvailable");
              const status =
                (e as Partial<typeof e>).status ?? common("unknown");

              return (
                <tr key={e.id}>
                  <td className="py-2 font-medium">
                    {e.title}
                    {e.visibility === "members_only" && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                        {common("memberOnly")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-zinc-500">{start}</td>
                  <td className="py-2">{status}</td>
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
                        {common("edit")}
                      </Link>
                      <Link
                        href={`/admin/attendees?eventId=${encodeURIComponent(e.id)}`}
                        className="text-blue-600 hover:underline"
                      >
                        {common("attendees")}
                      </Link>
                      <Link
                        href={`/admin/events/${e.id}/checkin`}
                        className="text-blue-600 hover:underline"
                      >
                        {common("checkIn")}
                      </Link>
                      <CloneEventButton eventId={e.id} eventTitle={e.title} />
                    </div>
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
