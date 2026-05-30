import Link from "@/i18n/navigation";
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
      <ErrorShell title="チェックインリンクが無効です">
        QRコードが古いか、URLが正しくありません。受付スタッフにお声がけください。
      </ErrorShell>
    );
  }
  if (event.status === "cancelled") {
    return (
      <ErrorShell title="イベントは中止されました">
        このイベントは中止されたため、チェックインできません。
      </ErrorShell>
    );
  }

  const window = checkInWindowState(event);
  if (window === "too_early") {
    return (
      <ErrorShell title="開始まで時間があります">
        <p>このイベントの開始時刻はまだ先です。</p>
        <p className="mt-2 text-zinc-500">
          開始: {formatDateTime(event.startAt)}
        </p>
      </ErrorShell>
    );
  }
  if (window === "too_late") {
    return (
      <ErrorShell title="チェックイン期間が終了しました">
        <p>このイベントは終了しており、チェックインを受け付けていません。</p>
      </ErrorShell>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 py-10 space-y-6">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-bold">{event.title}</h1>
        <p className="text-sm text-zinc-500">
          {formatDateTime(event.startAt)}
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
  children,
}: {
  title: string;
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
        イベント一覧へ
      </Link>
    </div>
  );
}
