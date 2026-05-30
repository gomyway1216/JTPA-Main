import Link from "@/i18n/navigation";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";
import { getEventById } from "@/lib/data/events";
import { listMyRsvpEventIds } from "@/lib/data/rsvps";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MyRsvpsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/my/rsvps");

  const ids = await listMyRsvpEventIds(user.uid).catch(() => []);
  const events = (await Promise.all(ids.map((id) => getEventById(id))))
    .filter((e): e is NonNullable<typeof e> => !!e);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <h1 className="text-2xl font-bold">参加履歴</h1>
      {events.length === 0 ? (
        <p className="text-zinc-500">参加登録履歴はありません。</p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {events.map((e) => (
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
    </div>
  );
}
