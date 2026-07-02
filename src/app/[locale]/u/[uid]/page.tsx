import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Image from "next/image";
import { notFound, permanentRedirect } from "next/navigation";

import { JsonLd } from "@/components/seo/JsonLd";
import { RolePill } from "@/components/users/AuthorBadge";
import { UserLinksRow } from "@/components/users/UserLinks";
import { localizedPath } from "@/i18n/paths";
import { getPublicContributionCounts } from "@/lib/data/contributions";
import { getPublicProfile } from "@/lib/data/users";
import {
  isMaintainerUid,
  MAINTAINER_NAME,
  MAINTAINER_PROFILE_PATH,
  maintainerLinksWithPinnedUrls,
  resolvePublicProfileUid,
} from "@/lib/maintainer";
import {
  absoluteLocalizedUrl,
  localizedAlternates,
  profilePageJsonLd,
} from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; uid: string }>;
}): Promise<Metadata> {
  const { locale, uid } = await params;
  const t = await getTranslations({ locale, namespace: "PublicProfile" });
  const profile = await getPublicProfile(resolvePublicProfileUid(uid));
  if (!profile) return { title: t("notFoundTitle") };
  const isMaintainer = isMaintainerUid(profile.uid);
  const title = isMaintainer
    ? t("maintainerMetadataTitle")
    : t("metadataTitle", { username: profile.username });
  const description = isMaintainer
    ? t("maintainerMetadataDescription")
    : profile.bio || undefined;
  const canonicalPath = isMaintainer ? MAINTAINER_PROFILE_PATH : `/u/${uid}`;
  const image = profile.photoURL ? [profile.photoURL] : undefined;
  // Regular profiles use @username — the universal handle — rather than
  // the full name, which may be private. The maintainer profile is an
  // explicit public attribution page, so it uses the stable real name.
  // Falls back to the bio for description when it's been opted-public;
  // `||` not `??` so an empty published bio ("") doesn't emit an empty
  // meta description (per PR #59 Gemini review).
  return {
    title,
    description,
    alternates: localizedAlternates(canonicalPath, locale),
    openGraph: {
      title,
      description,
      url: absoluteLocalizedUrl(canonicalPath, locale),
      images: image,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image,
    },
  };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ locale: string; uid: string }>;
}) {
  const { locale, uid } = await params;
  if (isMaintainerUid(uid)) {
    permanentRedirect(localizedPath(MAINTAINER_PROFILE_PATH, locale));
  }
  const t = await getTranslations("PublicProfile");
  const profile = await getPublicProfile(resolvePublicProfileUid(uid));
  if (!profile) notFound();
  const isMaintainer = isMaintainerUid(profile.uid);
  const displayName = isMaintainer
    ? MAINTAINER_NAME
    : profile.fullName || `@${profile.username}`;
  const links = isMaintainer
    ? maintainerLinksWithPinnedUrls(profile.links)
    : profile.links;

  // Published contribution tallies, computed at read time via `count()`
  // aggregations. Fetched after the profile guard so we don't spend five
  // aggregation reads on a non-existent user; the profile read itself is
  // a per-request cache hit (shared with `generateMetadata`), so there's
  // nothing live to parallelize it against on the happy path.
  const contributions = await getPublicContributionCounts(profile.uid);

  // Initials fallback for the avatar — same surrogate-safe `[...str][0]`
  // pattern as the AuthorBadge to handle emoji / non-BMP usernames. The
  // initial comes from the username (the primary label) rather than the
  // full name, which may be private.
  const initial = ([...profile.username][0] ?? "?").toUpperCase();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <JsonLd
        data={profilePageJsonLd({
          locale,
          profile,
          links,
          description: isMaintainer
            ? t("maintainerMetadataDescription")
            : profile.bio || undefined,
          contributionCount: contributions.total,
          isMaintainer,
        })}
      />
      <article className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900 space-y-5">
        <header className="flex items-start gap-4">
          {profile.photoURL ? (
            <Image
              src={profile.photoURL}
              alt={t("avatarAlt", { username: profile.username })}
              width={64}
              height={64}
              className="h-16 w-16 rounded-full border border-zinc-200 dark:border-zinc-800"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-lg font-semibold text-zinc-600 dark:border-zinc-800 dark:bg-zinc-800 dark:text-zinc-300">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            {/*
              Heading hierarchy follows the user's `fullNamePublic`
              choice for regular profiles; the maintainer profile is an
              explicit public attribution page and always leads with the
              stable real name. Either way the role pill sits next to
              whichever label takes the H1 — one notch larger than the
              inline AuthorBadge so it doesn't look like an afterthought
              next to the heading.
            */}
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold break-all">
              <span>{displayName}</span>
              {profile.role && <RolePill role={profile.role} size="lg" />}
            </h1>
            {(profile.fullName || isMaintainer) && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                @{profile.username}
              </p>
            )}
            {isMaintainer && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {t("maintainerRole")}
              </p>
            )}
            {profile.affiliation && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {profile.affiliation}
              </p>
            )}
          </div>
        </header>

        <UserLinksRow links={links} ownerLabel={displayName} />

        <dl className="border-y border-zinc-200 py-3 dark:border-zinc-800">
          <dt className="text-xs font-medium uppercase text-zinc-500">
            {t("eventAttendanceCount")}
          </dt>
          <dd className="mt-1 text-lg font-semibold">
            {t("eventAttendanceCountValue", {
              count: profile.eventAttendanceCount,
            })}
          </dd>
        </dl>

        {/*
          Published-contribution tallies: the five content types plus a
          Total cell (six in all). Every type is shown even at 0 so the
          grid stays a predictable shape and an empty slot reads as "none
          yet" rather than a missing feature. Reuses the same label/value
          typography as the attendance stat above so the two read as one
          family of profile metrics.
        */}
        <section className="border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <h2 className="text-xs font-medium uppercase text-zinc-500">
            {t("contributions")}
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {(
              [
                ["posts", contributions.posts],
                ["projects", contributions.projects],
                ["qa", contributions.qa],
                ["polls", contributions.polls],
                ["guides", contributions.guides],
                ["total", contributions.total],
              ] as const
            ).map(([key, count]) => (
              <div key={key}>
                <dt className="text-xs text-zinc-500">
                  {t(`contributionType.${key}`)}
                </dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                  {count}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {profile.bio ? (
          // Plain text with author-entered newlines preserved.
          // `break-words` handles long URLs / unbroken tokens.
          <section className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {profile.bio}
          </section>
        ) : (
          // Quiet placeholder rather than a missing section — keeps the
          // card from looking broken for users who've published nothing
          // beyond their name.
          <p className="text-sm text-zinc-500">
            {t("emptyBio")}
          </p>
        )}
      </article>
    </div>
  );
}
