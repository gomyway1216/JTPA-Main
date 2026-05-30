import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { CheckInClient } from "@/app/[locale]/events/[slug]/checkin/CheckInClient";
import { getSessionUser } from "@/lib/auth/session";
import { checkInWindowState } from "@/lib/check-in";
import { getEventBySlug } from "@/lib/data/events";
import { getMyRsvp } from "@/lib/data/rsvps";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CheckInPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const [{ slug }, { t: token }] = await Promise.all([params, searchParams]);
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("CheckIn"),
  ]);
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const user = await getSessionUser();
  const myRsvp = user ? await getMyRsvp(event.id, user.uid) : null;

  // Token + window are validated server-side here for UX (so a stale/expired
  // QR shows a clear message rather than letting the user fill out a form
  // that will fail). The server actions re-validate before writing — this
  // page is read-only and clients can't bypass the action gate.
  if (!event.checkInToken || !token || event.checkInToken !== token) {
    return (
      <ErrorShell title={t("invalidTitle")} eventsLabel={t("events")}>
        {t("invalidDescription")}
      </ErrorShell>
    );
  }
  if (event.status === "cancelled") {
    return (
      <ErrorShell title={t("cancelledTitle")} eventsLabel={t("events")}>
        {t("cancelledDescription")}
      </ErrorShell>
    );
  }

  const window = checkInWindowState(event);
  if (window === "too_early") {
    return (
      <ErrorShell title={t("tooEarlyTitle")} eventsLabel={t("events")}>
        <p>{t("tooEarlyDescription")}</p>
        <p className="mt-2 text-zinc-500">
          {t("start", { date: formatDateTime(event.startAt, locale) })}
        </p>
      </ErrorShell>
    );
  }
  if (window === "too_late") {
    return (
      <ErrorShell title={t("tooLateTitle")} eventsLabel={t("events")}>
        <p>{t("tooLateDescription")}</p>
      </ErrorShell>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">{event.title}</h1>
        <p className="text-sm text-zinc-500">
          {formatDateTime(event.startAt, locale)}
        </p>
      </header>
      <CheckInClient
        eventId={event.id}
        eventSlug={event.slug}
        token={token}
        signedInUser={
          user
            ? {
                uid: user.uid,
                displayName: user.displayName,
                email: user.email,
              }
            : null
        }
        alreadyCheckedIn={!!myRsvp?.attendedAt}
      />
    </div>
  );
}

function ErrorShell({
  title,
  eventsLabel,
  children,
}: {
  title: string;
  eventsLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-10 space-y-4 text-center">
      <h1 className="text-xl font-bold">{title}</h1>
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        {children}
      </div>
      <Link
        href="/events"
        className="inline-block text-sm text-blue-600 hover:underline"
      >
        {eventsLabel}
      </Link>
    </div>
  );
}
