import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getEventById } from "@/lib/data/events";
import { listMyRsvpEventIds } from "@/lib/data/rsvps";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function MyRsvpsPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("MyRsvps"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath("/my/rsvps", locale));

  const ids = await listMyRsvpEventIds(user.uid).catch(() => []);
  const events = (await Promise.all(ids.map((id) => getEventById(id))))
    .filter((e): e is NonNullable<typeof e> => !!e);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      {events.length === 0 ? (
        <p className="text-zinc-500">{t("empty")}</p>
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
                  {formatDateTime(e.startAt, locale)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
