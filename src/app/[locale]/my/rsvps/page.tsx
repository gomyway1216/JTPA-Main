import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { CancelRsvpButton } from "@/app/[locale]/my/rsvps/CancelRsvpButton";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getEventById } from "@/lib/data/events";
import { listMyRsvps } from "@/lib/data/rsvps";
import { formatDateTime, isEventEnded } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MyRsvpsPage() {
  const user = await getSessionUser();
  if (!user) {
    const locale = await getLocale();
    redirect(loginPath("/my/rsvps", locale));
  }

  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("MyRsvps"),
  ]);

  const rsvps = await listMyRsvps(user.uid).catch(() => []);
  const rows = (
    await Promise.all(
      rsvps.map(async ({ eventId, rsvp }) => {
        const event = await getEventById(eventId);
        return event ? { event, rsvp } : null;
      }),
    )
  ).filter((row): row is NonNullable<typeof row> => !!row);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      {rows.length === 0 ? (
        <p className="text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map(({ event, rsvp }) => {
            const canCancel =
              rsvp.status !== "cancelled" && !isEventEnded(event);
            return (
              <li key={event.id} className="py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Link
                    href={`/events/${event.slug}`}
                    className="min-w-0 hover:underline"
                  >
                    <span className="block truncate font-medium">
                      {event.title}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">
                      {formatDateTime(event.startAt, locale)}
                    </span>
                  </Link>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {t(`status.${rsvp.status}`)}
                    </span>
                    {canCancel && <CancelRsvpButton eventId={event.id} />}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
