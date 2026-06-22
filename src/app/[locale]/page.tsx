import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";

import { EmptyState } from "@/components/ui/EmptyState";
import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { loginHref } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import {
  listApprovedProjectsForLocaleCached,
  listUpcomingEventsCached,
} from "@/lib/data/cached";
import { getPublicProfilesByUids } from "@/lib/data/users";
import type { LocationType } from "@/lib/types";
import { formatDateTime, stripMarkdown } from "@/lib/utils";

// The route still renders per request (the root layout reads the session
// cookie for the header), but the Firestore reads below are served from
// the shared data cache — see src/lib/data/cached.ts for windows/tags.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const locale = await getLocale();
  const t = await getTranslations("Home");
  const common = await getTranslations("Common");
  const [events, projects, user] = await Promise.all([
    listUpcomingEventsCached(3).catch(() => []),
    listApprovedProjectsForLocaleCached(locale, 6).catch(() => []),
    getSessionUser(),
  ]);
  const ownerProfiles = await getPublicProfilesByUids(
    projects.map((p) => p.ownerUid),
  ).catch(() => new Map());
  const profileSetupHref = loginHref("/my/profile", locale);

  return (
    <div className="space-y-24 pb-20 sm:space-y-32 sm:pb-24">
      {/* Hero is full-bleed so the decorative blobs + dot grid can fill
          the whole viewport width. The content inside re-applies
          `mx-auto max-w-6xl` so the text and CTAs stay aligned with the
          centered card grid below.

          `min-h` is capped to a comfortable hero height on mobile (so
          short copy + 2 CTAs don't leave a giant empty rectangle below
          the buttons) and stretches to most-of-the-viewport from `sm:`
          up, where the heavier desktop type wants more breathing room. */}
      <section className="relative isolate flex min-h-[36rem] items-center overflow-hidden sm:min-h-[calc(100vh-12rem)]">
        {/*
         * Three decorative layers, all `pointer-events-none` +
         * `aria-hidden`, scoped under `isolate` so their negative
         * z-index doesn't slip behind the header:
         *   - dot grid: signals "tech" without a literal terminal
         *     pattern. Fades to transparent at the edges via a
         *     radial mask (see `.hero-dot-grid` in globals.css) so it
         *     doesn't compete with surrounding sections.
         *   - top-right + bottom-left blobs: cooler at one corner,
         *     warmer at the other for a sense of depth.
         */}
        <div
          aria-hidden="true"
          className="hero-dot-grid pointer-events-none absolute inset-0 -z-20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-32 -z-10 h-[560px] w-[720px] max-w-full rounded-full bg-gradient-to-br from-blue-500/25 via-indigo-500/20 to-violet-500/25 blur-3xl dark:from-blue-500/35 dark:via-indigo-500/30 dark:to-violet-500/35"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 -z-10 h-[460px] w-[600px] max-w-full rounded-full bg-gradient-to-tr from-violet-500/20 via-indigo-500/15 to-blue-500/20 blur-3xl dark:from-violet-500/30 dark:via-indigo-500/25 dark:to-blue-500/30"
        />

        <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-10 px-4 py-12 sm:py-16 lg:grid-cols-[5fr_2fr] lg:gap-12">
          {/* Left: text content */}
          <div className="flex flex-col gap-6 sm:gap-8">
            <h1 className="text-3xl font-semibold leading-[1.1] tracking-tighter sm:text-5xl sm:leading-[1.05] lg:text-7xl">
              <span className="bg-shimmer-gradient animate-gradient-shimmer bg-clip-text text-transparent">
                AI
              </span>
              {t("headlinePrefix")}
              <br className="hidden sm:inline" />
              <span className="sm:hidden">{locale === "en" ? " " : ""}</span>
              {t("headlineSuffix")}
            </h1>

            <p className="text-lg text-zinc-600 sm:text-xl sm:leading-relaxed dark:text-zinc-300">
              {t("intro1")} {t("intro2")}
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href="/community"
                className="inline-flex items-center justify-center rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-[length:200%_100%] bg-left px-5 py-2 text-sm font-medium text-white shadow-sm shadow-indigo-500/30 transition-all hover:bg-right hover:shadow-md hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-white active:scale-[0.98] dark:from-blue-500 dark:via-indigo-500 dark:to-violet-500 dark:shadow-indigo-400/20 dark:focus:ring-indigo-400 dark:focus:ring-offset-zinc-950"
              >
                {t("communityCta")}
              </Link>
              <Link
                href="/events"
                className="rounded-full border border-zinc-300/70 bg-white/70 px-5 py-2 text-sm font-medium backdrop-blur transition hover:bg-white hover:shadow-sm dark:border-zinc-700/70 dark:bg-zinc-950/70 dark:hover:bg-zinc-900"
              >
                {t("eventsCta")}
              </Link>
              <Link
                href="/showcase"
                className="rounded-full border border-zinc-300/70 bg-white/70 px-5 py-2 text-sm font-medium backdrop-blur transition hover:bg-white hover:shadow-sm dark:border-zinc-700/70 dark:bg-zinc-950/70 dark:hover:bg-zinc-900"
              >
                {t("showcaseCta")}
              </Link>
            </div>
          </div>

          {/* Right: logo */}
          <div className="flex items-center justify-center">
            <Image
              src="/images/logo_640_460.png"
              alt={t("siteName")}
              width={640}
              height={460}
              priority
              className="h-auto w-full"
            />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-20 px-4">
        <FadeUp
          as="section"
          className="border-y border-zinc-200 py-8 sm:py-10 dark:border-zinc-800"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-medium uppercase text-zinc-500">
                {t("profileHubEyebrow")}
              </p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                {t("profileHubTitle")}
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {user
                  ? t("profileHubSignedInDescription")
                  : t("profileHubGuestDescription")}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-3">
              {user ? (
                <>
                  <Link
                    href={`/u/${user.uid}`}
                    className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
                  >
                    {t("profileHubPublicCta")}
                  </Link>
                  <Link
                    href="/my/profile"
                    className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {t("profileHubSettingsCta")}
                  </Link>
                </>
              ) : (
                <Link
                  href={profileSetupHref}
                  className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-300"
                >
                  {t("profileHubLoginCta")}
                </Link>
              )}
            </div>
          </div>
        </FadeUp>

      <FadeUp as="section" className="space-y-6">
        {/* Section head row. On phones the view-all link slides under
            the heading so the H2 + subtitle get the full content width
            (otherwise the localized section titles wrap into a
            narrow column and break mid-word). From `sm:` we put the
            link back on the right rail. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("upcomingEvents")}</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {t("upcomingEventsDescription")}
            </p>
          </div>
          <Link
            href="/events"
            className="shrink-0 text-sm font-medium text-accent hover:underline"
          >
            {common("viewAll")}
          </Link>
        </div>
        {events.length === 0 ? (
          <EmptyState
            message={t("noEvents")}
            hint={t("noEventsHint")}
          />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e, i) => (
              <FadeUp key={e.id} as="li" delay={i} className="flex">
                <Link
                  href={`/events/${e.slug}`}
                  className={`${interactiveCardClass} flex h-full w-full flex-col overflow-hidden`}
                >
                  {e.coverImage?.url && (
                    // width/height only set the pre-load aspect-ratio hint;
                    // the rendered box is fixed by the aspect-[16/9] class.
                    <Image
                      src={e.coverImage.url}
                      alt={common("coverImageAlt", { title: e.title })}
                      width={1600}
                      height={900}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="aspect-[16/9] w-full object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs uppercase tracking-wide text-zinc-500">
                        {formatDateTime(e.startAt, locale)}
                      </p>
                      <LocationPill
                        type={e.location?.type}
                        label={
                          e.location?.type
                            ? common(`location.${e.location.type}`)
                            : ""
                        }
                      />
                    </div>
                    <h3 className="mt-2 line-clamp-2 text-lg font-semibold">
                      {e.title}
                    </h3>
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                      {e.description}
                    </p>
                  </div>
                </Link>
              </FadeUp>
            ))}
          </ul>
        )}
      </FadeUp>

      <FadeUp as="section" className="space-y-6">
        {/* Same stack-on-mobile rationale as the events head
            above. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t("featuredProjects")}</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {t("featuredProjectsDescription")}
            </p>
          </div>
          <Link
            href="/showcase"
            className="shrink-0 text-sm font-medium text-accent hover:underline"
          >
            {common("viewAll")}
          </Link>
        </div>
        {projects.length === 0 ? (
          <EmptyState
            message={t("noProjects")}
            hint={
              <>
                {t("submitProjectPrefix")}{" "}
                <Link href="/projects/new" className="font-medium text-accent underline">
                  {t("submitProjectLink")}
                </Link>
                {" "}
                {t("submitProjectSuffix")}
              </>
            }
          />
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p, i) => (
              <FadeUp key={p.id} as="li" delay={i} className="flex">
                <Link
                  href={`/showcase/${p.slug}`}
                  className={`${interactiveCardClass} flex h-full w-full flex-col overflow-hidden`}
                >
                  {p.thumbnail?.url && (
                    <Image
                      src={p.thumbnail.url}
                      alt={common("thumbnailAlt", { title: p.title })}
                      width={1600}
                      height={900}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="aspect-[16/9] w-full object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="line-clamp-2 text-lg font-semibold">{p.title}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                      <AuthorBadge
                        profile={ownerProfiles.get(p.ownerUid) ?? null}
                        linkable={false}
                      />
                    </p>
                    <p className="mt-2 line-clamp-3 flex-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {stripMarkdown(p.description)}
                    </p>
                    {p.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {p.tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </FadeUp>
            ))}
          </ul>
        )}
      </FadeUp>
      </div>
    </div>
  );
}

function LocationPill({ type, label }: { type?: LocationType; label: string }) {
  if (!type) return null;
  const classes =
    type === "online"
      ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      : type === "hybrid"
        ? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
        : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300";
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {label}
    </span>
  );
}
