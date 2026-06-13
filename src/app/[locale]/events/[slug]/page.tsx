import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import { notFound, redirect } from "next/navigation";

import { PresentationSection } from "@/app/[locale]/events/[slug]/PresentationSection";
import { RsvpSection } from "@/app/[locale]/events/[slug]/RsvpSection";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { JsonLd } from "@/components/seo/JsonLd";
import { localizedPath, loginHref, loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getEventBySlug } from "@/lib/data/events";
import { listPresentations } from "@/lib/data/presentations";
import { getMyRsvp } from "@/lib/data/rsvps";
import { getMyProfile, getPublicProfilesByUids } from "@/lib/data/users";
import { siteBaseUrl } from "@/lib/site";
import type { EventDoc } from "@/lib/types";
import {
  formatDateTime,
  isEventEnded,
  stripMarkdown,
  toDate,
  truncate,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

function eventImageUrls(event: EventDoc): string[] {
  return Array.from(
    new Set([
      event.coverImage?.url,
      ...(event.subImages ?? []).map((image) => image.url),
    ].filter((url): url is string => Boolean(url))),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEventBySlug(slug).catch(() => null);
  // Mirror the page's own gating (`if (!event) notFound()`): any status the
  // page renders gets metadata. Members-only events are safe to describe
  // here — the page redirects anonymous visitors before a <head> is ever
  // sent, so crawlers/unfurlers only see the login redirect.
  if (!event) return {};
  const description = truncate(stripMarkdown(event.description), 160);
  const imageUrls = eventImageUrls(event);
  const images = imageUrls.length > 0 ? imageUrls : undefined;
  return {
    title: event.title,
    description,
    openGraph: {
      title: event.title,
      description,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: event.title,
      description,
      images,
    },
  };
}

// schema.org/Event structured data. The location maps from our LocationType:
// offline → Place, online → VirtualLocation, hybrid → both. VirtualLocation
// deliberately points at the event page (not `location.meetingUrl`) — the
// meeting link is only ever delivered to confirmed attendees and must not
// leak into crawlable markup.
function eventJsonLd(event: EventDoc, eventUrl: string) {
  const images = eventImageUrls(event);
  const place = event.location.address
    ? { "@type": "Place", address: event.location.address }
    : null;
  const virtual =
    event.location.type !== "offline"
      ? { "@type": "VirtualLocation", url: eventUrl }
      : null;
  const locations = [
    ...(event.location.type !== "online" && place ? [place] : []),
    ...(virtual ? [virtual] : []),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    description: truncate(stripMarkdown(event.description), 160),
    // toDate() handles the serialized Timestamp shape; toISOString() emits
    // ISO 8601 in UTC (trailing `Z`), which satisfies the "with timezone"
    // requirement for Event rich results.
    startDate: toDate(event.startAt)?.toISOString(),
    endDate: toDate(event.endAt)?.toISOString(),
    location:
      locations.length === 0
        ? undefined
        : locations.length === 1
          ? locations[0]
          : locations,
    image: images.length > 0 ? images : undefined,
    url: eventUrl,
    organizer: {
      "@type": "Organization",
      name: "JTPA",
      url: siteBaseUrl(),
    },
  };
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [locale, t, common, auth] = await Promise.all([
    getLocale(),
    getTranslations("EventDetail"),
    getTranslations("Common"),
    getTranslations("Auth"),
  ]);
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const user = await getSessionUser();
  // Members-only events redirect anonymous visitors to login. Admins always
  // pass; the firestore.rules backstop already enforces the same boundary.
  if (event.visibility === "members_only" && !user) {
    redirect(loginPath(`/events/${slug}`, locale));
  }
  // Profile load is parallel with RSVP/presentations so it doesn't add
  // latency on the warm path. Only needed to pre-fill the affiliation
  // field on first-time RSVP — once the user has an existing RSVP doc,
  // RsvpSection prefers that value (it's the most recent confirmation
  // of what they want associated with this specific event).
  const [myRsvp, presentations, profile] = await Promise.all([
    user ? getMyRsvp(event.id, user.uid) : Promise.resolve(null),
    listPresentations(event.id).catch(() => []),
    user ? getMyProfile(user.uid).catch(() => null) : Promise.resolve(null),
  ]);
  // Batched public-profile read for every presenter on the agenda so
  // PresentationSection can render @usernames without per-row fetches.
  const presenterProfiles = await getPublicProfilesByUids(
    presentations.map((p) => p.presenterUid),
  );
  const subImages = event.subImages ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <JsonLd
        data={eventJsonLd(
          event,
          `${siteBaseUrl()}${localizedPath(`/events/${event.slug}`, locale)}`,
        )}
      />

      {event.coverImage?.url && (
        // aspect-[21/9] keeps the hero a cinematic-ish banner regardless of
        // the source aspect ratio — without this, a portrait upload would
        // push the title way below the fold. `preload` because this is the
        // above-the-fold LCP element whenever a cover exists.
        <Image
          src={event.coverImage.url}
          alt={t("coverAlt", { title: event.title })}
          width={1680}
          height={720}
          preload
          sizes="(max-width: 768px) 100vw, 736px"
          className="aspect-[21/9] w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      <header className="space-y-3">
        <p className="text-sm text-zinc-500">
          {formatDateTime(event.startAt, locale)}
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          {event.title}
          {event.visibility === "members_only" && (
            <span className="ml-3 align-middle rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {t("memberOnly")}
            </span>
          )}
        </h1>
        <dl className="grid grid-cols-1 gap-2 text-sm text-zinc-600 dark:text-zinc-400 sm:grid-cols-2">
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">
              {t("start")}
            </dt>
            <dd>{formatDateTime(event.startAt, locale)}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">
              {t("end")}
            </dt>
            <dd>{formatDateTime(event.endAt, locale)}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">
              {t("format")}
            </dt>
            <dd>
              {common(`location.${event.location.type}`)}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800 dark:text-zinc-200">
              {t("capacity")}
            </dt>
            <dd>
              {event.rsvpCount} / {event.capacity ?? t("capacityUnknown")}
            </dd>
          </div>
          {event.location.address && (
            <div className="sm:col-span-2">
              <dt className="font-medium text-zinc-800 dark:text-zinc-200">
                {t("venue")}
              </dt>
              <dd>
                {event.location.address}
                {event.location.mapUrl && (
                  <>
                    {" "}
                    <a
                      href={event.location.mapUrl}
                      className="text-blue-600 hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("map")}
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
      </header>

      {/* Markdown description — same renderer as Guides (issue #101), so an
          event body gets GFM tables/lists, syntax highlighting, heading
          demotion, and external links opening in a new tab, all styled by
          `prose-jtpa`. Authors write Markdown (blank line between
          paragraphs); plain text still renders fine. */}
      <section>
        <MarkdownBody source={event.description} />
      </section>

      {subImages.length > 0 && (
        <section
          aria-label={t("subImagesLabel")}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {subImages.map((image, i) => (
            <Image
              key={image.path}
              src={image.url}
              alt={t("subImageAlt", { index: i + 1, title: event.title })}
              width={960}
              height={720}
              sizes="(max-width: 640px) 100vw, 360px"
              className="aspect-[4/3] w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
            />
          ))}
        </section>
      )}

      <hr className="border-zinc-200 dark:border-zinc-800" />

      {isEventEnded(event) ? (
        // Past events show a static notice instead of the RSVP form. The
        // presentation list below is intentionally still rendered — slides
        // remain useful after the fact.
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-6 text-center text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-zinc-700 dark:text-zinc-300">
            {event.status === "cancelled"
              ? t("cancelledNotice")
              : t("endedNotice")}
          </p>
        </div>
      ) : user ? (
        <RsvpSection
          event={event}
          initialRsvp={myRsvp}
          user={user}
          profileAffiliation={profile?.affiliation ?? ""}
        />
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-zinc-700 dark:text-zinc-300 mb-3">
            {t("loginRequired")}
          </p>
          <Link
            href={loginHref(`/events/${event.slug}`, locale)}
            className="inline-flex rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {auth("googleLogin")}
          </Link>
        </div>
      )}

      <PresentationSection
        eventId={event.id}
        eventSlug={event.slug}
        user={user}
        myRsvp={myRsvp}
        initialPresentations={presentations}
        presenterProfiles={Object.fromEntries(presenterProfiles)}
      />
    </div>
  );
}
