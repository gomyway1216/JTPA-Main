import QRCode from "qrcode";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TokenControls } from "@/app/admin/events/[id]/checkin/TokenControls";
import { getSessionUser } from "@/lib/auth/session";
import { getEventById } from "@/lib/data/events";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AdminCheckInPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user?.isAdmin) redirect("/admin/guides");

  const { id } = await params;
  const event = await getEventById(id);
  if (!event) notFound();

  // The public origin is required to build the absolute QR URL since the
  // QR is meant to be scanned from a phone external to the server. Fall
  // back to a relative URL — phones will fail to scan it, but at least the
  // admin can copy the path and prepend the right host manually.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const checkInUrl = event.checkInToken
    ? `${baseUrl}/events/${event.slug}/checkin?t=${event.checkInToken}`
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
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">チェックイン</h1>
        <p className="text-sm text-zinc-500">
          {event.title}（{formatDateTime(event.startAt)}）
        </p>
      </header>

      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <Stat label="RSVP数" value={event.rsvpCount} />
        <Stat label="出席数" value={event.attendanceCount ?? 0} />
        <Stat label="ウェイトリスト" value={event.waitlistCount} />
      </div>

      <section className="rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
        {event.checkInToken && qrSvg && checkInUrl ? (
          <div className="flex flex-col items-center gap-4">
            <div
              className="bg-white p-3 rounded"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="break-all text-center text-xs text-zinc-500">
              {checkInUrl}
            </p>
            <p className="text-xs text-zinc-500">
              トークン: <code className="font-mono">{event.checkInToken}</code>
            </p>
          </div>
        ) : (
          <p className="text-center text-sm text-zinc-500">
            まだトークンが発行されていません。下のボタンで生成してください。
          </p>
        )}
      </section>

      <TokenControls eventId={event.id} hasToken={!!event.checkInToken} />

      <p className="text-xs text-zinc-500">
        QRコードは当日のみ有効です（開始の4時間前〜終了の6時間後まで）。漏洩した場合は再生成すれば即座に無効化されます。
      </p>

      <Link
        href="/admin/attendees"
        className="inline-block text-sm text-blue-600 hover:underline"
      >
        参加者一覧で出席状況を確認
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
