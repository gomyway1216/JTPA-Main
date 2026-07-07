import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";

import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { getSessionUser } from "@/lib/auth/session";
import {
  getPostBySlugCached,
  listPastEventsCached,
  listUpcomingEventsCached,
} from "@/lib/data/cached";
import { eventTimeZone } from "@/lib/time-zones";
import type { EventDoc } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

// Per-request render (the members-only filter below needs the session);
// the event lists come from the shared data cache with a short (60s)
// window because they surface rsvpCount and split on "ended yet?".
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

async function publishedReportHrefsBySlug(
  events: EventDoc[],
): Promise<Map<string, string>> {
  const slugs = Array.from(
    new Set(
      events
        .map((event) => event.reportPostSlug)
        .filter((slug): slug is string => Boolean(slug)),
    ),
  );
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const post = await getPostBySlugCached(slug).catch(() => null);
      if (post?.status !== "published") return null;
      const href: string = `/blog/${post.slug}`;
      return [slug, href] as const;
    }),
  );
  return new Map(
    entries.filter((entry): entry is readonly [string, string] =>
      Boolean(entry),
    ),
  );
}

export default async function EventsPage() {
  const locale = await getLocale();
  const t = await getTranslations("EventsPage");
  const common = await getTranslations("Common");
  const user = await getSessionUser();
  const signedIn = !!user;
  const [upcomingRaw, pastRaw] = await Promise.all([
    listUpcomingEventsCached(30).catch(() => []),
    listPastEventsCached(10).catch(() => []),
  ]);
  const upcoming = upcomingRaw.filter(visibleTo(signedIn));
  const past = pastRaw.filter(visibleTo(signedIn));
  const reportHrefBySlug = await publishedReportHrefsBySlug([
    ...upcoming,
    ...past,
  ]);

  const renderEventCard = (
    e: EventDoc,
    i: number,
    Heading: "h2" | "h3" = "h2",
  ) => {
    const reportHref = reportHrefBySlug.get(e.reportPostSlug ?? "");
    return (
      <FadeUp key={e.id} as="li" delay={i} className="block">
        <article
          className={`${interactiveCardClass} relative flex flex-col gap-0 overflow-hidden sm:flex-row`}
        >
          {e.coverImage?.url && (
            // Full-width strip on phones, fixed 192px rail from sm:.
            <Image
              src={e.coverImage.url}
              alt={common("coverImageAlt", { title: e.title })}
              width={1600}
              height={900}
              sizes="(max-width: 640px) 100vw, 192px"
              className="h-40 w-full object-cover sm:w-48 sm:shrink-0"
            />
          )}
          <div className="flex flex-1 flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-zinc-500">
                {formatDateTime(e.startAt, locale, eventTimeZone(e))}
              </p>
              <Heading className="mt-1 text-lg font-semibold">{e.title}</Heading>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                {e.location.type === "online"
                  ? common("location.online")
                  : e.location.type === "hybrid"
                    ? common("location.hybrid")
                    : e.location.address || t("venue")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
              <div className="text-sm text-zinc-500">
                {t("rsvpCount", {
                  count: e.rsvpCount,
                  capacity: e.capacity ?? t("capacityUnknown"),
                })}
              </div>
              {reportHref && (
                <Link
                  href={reportHref}
                  className="relative z-20 inline-flex rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-200 dark:hover:bg-indigo-900"
                >
                  {t("reportCta")}
                </Link>
              )}
            </div>
          </div>
          <Link
            href={`/events/${e.slug}`}
            aria-label={t("openEvent", { title: e.title })}
            className="absolute inset-0 z-10 rounded-[inherit] focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <span className="sr-only">{t("openEvent", { title: e.title })}</span>
          </Link>
        </article>
      </FadeUp>
    );
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 space-y-16">
      <section>
        <h1 className="mb-8 text-4xl font-semibold tracking-tight sm:text-5xl">{t("upcoming")}</h1>
        {upcoming.length === 0 ? (
          <p className="text-zinc-500">{t("noUpcoming")}</p>
        ) : (
          <ul className="space-y-4">
            {upcoming.map((e, i) => renderEventCard(e, i, "h2"))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">{t("past")}</h2>
        {past.length === 0 ? (
          <p className="text-zinc-500 text-sm">{t("noPast")}</p>
        ) : (
          <ul className="space-y-4">
            {past.map((e, i) => renderEventCard(e, i, "h3"))}
          </ul>
        )}
      </section>
    </div>
  );
}
