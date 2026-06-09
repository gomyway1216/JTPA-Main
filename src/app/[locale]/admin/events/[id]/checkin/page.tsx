import QRCode from "qrcode";
import { headers } from "next/headers";
import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { QrDisplayControls } from "@/app/[locale]/admin/events/[id]/checkin/QrDisplayControls";
import { TokenControls } from "@/app/[locale]/admin/events/[id]/checkin/TokenControls";
import { getSessionUser } from "@/lib/auth/session";
import {
  buildCheckInOrigin,
  buildCheckInUrl,
  checkInWindowSettings,
} from "@/lib/check-in";
import { getEventById } from "@/lib/data/events";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("Admin.checkIn"),
  ]);

  const { id } = await params;
  const event = await getEventById(id);
  if (!event) notFound();
  const eventDate = formatDateTime(event.startAt, locale);
  const { earlyMinutes, lateMinutes } = checkInWindowSettings(event);

  // The public origin is required to build the absolute QR URL since the
  // QR is meant to be scanned from a phone external to the server. Prefer
  // the explicit `NEXT_PUBLIC_SITE_URL` env var (correct behind reverse
  // proxies that rewrite Host), fall back to the request's own host so
  // preview / dev environments work without configuration.
  const headerStore = await headers();
  const baseUrl = buildCheckInOrigin({
    explicitOrigin: process.env.NEXT_PUBLIC_SITE_URL,
    forwardedHost: headerStore.get("x-forwarded-host"),
    forwardedProto: headerStore.get("x-forwarded-proto"),
    host: headerStore.get("host"),
  });
  const checkInUrl =
    baseUrl && event.checkInToken
      ? buildCheckInUrl(baseUrl, event.slug, event.checkInToken)
      : null;
  const qrSvg = checkInUrl
    ? await QRCode.toString(checkInUrl, {
        type: "svg",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 320,
      })
    : null;

  return (
    <div className="space-y-6 print:space-y-0">
      <header className="space-y-1 print:hidden">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-zinc-500">
          {event.title} ({eventDate})
        </p>
      </header>

      <div className="grid gap-2 text-sm sm:grid-cols-3 print:hidden">
        <Stat label={t("rsvpCount")} value={event.rsvpCount} />
        <Stat label={t("attendanceCount")} value={event.attendanceCount ?? 0} />
        <Stat label={t("waitlistCount")} value={event.waitlistCount} />
      </div>

      <section
        id="check-in-poster"
        className="rounded-lg border border-zinc-200 bg-white p-6 text-zinc-950 dark:border-zinc-800 print:flex print:min-h-screen print:items-center print:justify-center print:rounded-none print:border-0 print:p-8"
      >
        {!event.checkInToken ? (
          <p className="text-center text-sm text-zinc-500">
            {t("noToken")}
          </p>
        ) : !baseUrl ? (
          // Defensive: the request-header fallback should always work, so
          // this path only fires in unusual setups (e.g. the server is
          // misconfigured to strip Host). Surface it so the admin doesn't
          // print an unscannable QR.
          <p className="text-center text-sm text-red-600">
            {t("hostError")} <code>NEXT_PUBLIC_SITE_URL</code> {t("hostErrorAction")}
          </p>
        ) : qrSvg && checkInUrl ? (
          <div className="check-in-poster-inner flex flex-col items-center gap-4 text-center print:gap-6">
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t("posterLabel")}
              </p>
              <h2 className="text-2xl font-bold print:text-3xl">
                {event.title}
              </h2>
              <p className="text-sm text-zinc-500">{eventDate}</p>
            </div>
            <div
              className="check-in-qr rounded bg-white p-3"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="max-w-2xl break-all text-xs text-zinc-500 print:text-sm">
              {checkInUrl}
            </p>
            <p className="text-xs text-zinc-500">
              {t("token")} <code className="font-mono">{event.checkInToken}</code>
            </p>
          </div>
        ) : null}
      </section>

      {qrSvg && checkInUrl ? (
        <QrDisplayControls targetId="check-in-poster" />
      ) : null}

      <div className="print:hidden">
        <TokenControls eventId={event.id} hasToken={!!event.checkInToken} />
      </div>

      <p className="text-xs text-zinc-500 print:hidden">
        {t("note", {
          earlyHours: earlyMinutes / 60,
          lateHours: lateMinutes / 60,
        })}
      </p>

      <Link
        href="/admin/attendees"
        className="inline-block text-sm text-blue-600 hover:underline print:hidden"
      >
        {t("attendeesLink")}
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
