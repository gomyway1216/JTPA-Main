import Link from "next/link";

import { getSessionUser } from "@/lib/auth/session";
import { listEvents, listPastEvents } from "@/lib/data/events";
import type { EventDoc } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata = { title: "イベント一覧" };

// Hide members-only events from logged-out visitors. The Firestore rules
// already enforce this at the read layer, but filtering here keeps the page
// from rendering "blank" listings for users who don't have access.
function visibleTo(signedIn: boolean) {
  return (e: EventDoc) => signedIn || e.visibility !== "members_only";
}

export default async function EventsPage() {
  const user = await getSessionUser();
  const signedIn = !!user;
  const [upcomingRaw, pastRaw] = await Promise.all([
    listEvents({ notEndedOnly: true, limit: 30 }).catch(() => []),
    listPastEvents(10).catch(() => []),
  ]);
  const upcoming = upcomingRaw.filter(visibleTo(signedIn));
  const past = pastRaw.filter(visibleTo(signedIn));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-12">
      <section>
        <h1 className="text-3xl font-bold mb-6">予定されているイベント</h1>
        {upcoming.length === 0 ? (
          <p className="text-zinc-500">現在予定されているイベントはありません。</p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((e) => (
              <li
                key={e.id}
                className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              >
                <Link
                  href={`/events/${e.slug}`}
                  className="flex flex-col gap-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 sm:flex-row"
                >
                  {e.coverImage?.url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={e.coverImage.url}
                      alt={`${e.title} のカバー画像`}
                      loading="lazy"
                      decoding="async"
                      className="h-40 w-full object-cover sm:w-48 sm:shrink-0"
                    />
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">
                        {formatDateTime(e.startAt)}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold">{e.title}</h2>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        {e.location.type === "online"
                          ? "オンライン"
                          : e.location.type === "hybrid"
                            ? "ハイブリッド"
                            : e.location.address || "会場あり"}
                      </p>
                    </div>
                    <div className="text-sm text-zinc-500">
                      {e.rsvpCount} / {e.capacity || "—"} 参加予定
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">過去のイベント</h2>
        {past.length === 0 ? (
          <p className="text-zinc-500 text-sm">過去のイベントはまだありません。</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {past.map((e) => (
              <li key={e.id} className="py-3">
                <Link
                  href={`/events/${e.slug}`}
                  className="flex items-center justify-between gap-3 hover:underline"
                >
                  <span className="font-medium">{e.title}</span>
                  <span className="text-xs text-zinc-500">
                    {formatDateTime(e.startAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
