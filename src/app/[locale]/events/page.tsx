import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { getSessionUser } from "@/lib/auth/session";
import { listEvents, listPastEvents } from "@/lib/data/events";
import type { EventDoc } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("EventsPage");
  return { title: t("metadataTitle") };
}

// Hide members-only events from logged-out visitors. The Firestore rules
// already enforce this at the read layer, but filtering here keeps the page
// from rendering "blank" listings for users who don't have access.
function visibleTo(signedIn: boolean) {
  return (e: EventDoc) => signedIn || e.visibility !== "members_only";
}

export default async function EventsPage() {
  const locale = await getLocale();
  const t = await getTranslations("EventsPage");
  const common = await getTranslations("Common");
  const user = await getSessionUser();
  const signedIn = !!user;
  const [upcomingRaw, pastRaw] = await Promise.all([
    listEvents({ notEndedOnly: true, limit: 30 }).catch(() => []),
    listPastEvents(10).catch(() => []),
  ]);
  const upcoming = upcomingRaw.filter(visibleTo(signedIn));
  const past = pastRaw.filter(visibleTo(signedIn));

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 space-y-16">
      <section>
        <h1 className="mb-8 text-4xl font-semibold tracking-tight sm:text-5xl">{t("upcoming")}</h1>
        {upcoming.length === 0 ? (
          <p className="text-zinc-500">{t("noUpcoming")}</p>
        ) : (
          <ul className="space-y-4">
            {upcoming.map((e, i) => (
              <FadeUp key={e.id} as="li" delay={i} className="block">
                <Link
                  href={`/events/${e.slug}`}
                  className={`${interactiveCardClass} flex flex-col gap-0 overflow-hidden sm:flex-row`}
                >
                  {e.coverImage?.url && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={e.coverImage.url}
                      alt={common("coverImageAlt", { title: e.title })}
                      loading="lazy"
                      decoding="async"
                      className="h-40 w-full object-cover sm:w-48 sm:shrink-0"
                    />
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-zinc-500">
                        {formatDateTime(e.startAt, locale)}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold">{e.title}</h2>
                      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                        {e.location.type === "online"
                          ? common("location.online")
                          : e.location.type === "hybrid"
                            ? common("location.hybrid")
                            : e.location.address || t("venue")}
                      </p>
                    </div>
                    <div className="text-sm text-zinc-500">
                      {t("rsvpCount", {
                        count: e.rsvpCount,
                        capacity: e.capacity ?? t("capacityUnknown"),
                      })}
                    </div>
                  </div>
                </Link>
              </FadeUp>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">{t("past")}</h2>
        {past.length === 0 ? (
          <p className="text-zinc-500 text-sm">{t("noPast")}</p>
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
                    {formatDateTime(e.startAt, locale)}
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
