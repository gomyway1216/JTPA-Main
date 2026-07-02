import type { Metadata } from "next";

import { localizedPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import type { PublicProfile } from "@/lib/data/users";
import {
  MAINTAINER_LINKS,
  MAINTAINER_NAME,
  MAINTAINER_PROFILE_PATH,
  MAINTAINER_SAME_AS,
  publicProfilePathForUid,
} from "@/lib/maintainer";
import { siteBaseUrl } from "@/lib/site";
import type { UserLinks } from "@/lib/types";

export function localizedAlternates(
  path: string,
  locale: string,
): Metadata["alternates"] {
  const languages = Object.fromEntries(
    routing.locales.map((candidate) => [
      candidate,
      absoluteLocalizedUrl(path, candidate),
    ]),
  );

  return {
    canonical: absoluteLocalizedUrl(path, locale),
    languages: {
      ...languages,
      "x-default": absoluteLocalizedUrl(path, routing.defaultLocale),
    },
  };
}

export function absoluteLocalizedUrl(path: string, locale: string): string {
  return `${siteBaseUrl()}${localizedPath(path, locale)}`;
}

function uniqueUrls(urls: readonly (string | undefined)[]): string[] {
  return Array.from(new Set(urls.filter((url): url is string => Boolean(url))));
}

function linksToSameAs(links: UserLinks): string[] {
  return uniqueUrls([links.portfolio, links.github, links.linkedin, links.sns]);
}

export function maintainerPersonId(): string {
  return `${absoluteLocalizedUrl(
    MAINTAINER_PROFILE_PATH,
    routing.defaultLocale,
  )}#person`;
}

export function siteOrganizationId(): string {
  return `${siteBaseUrl()}#organization`;
}

export function siteWebsiteId(): string {
  return `${siteBaseUrl()}#website`;
}

export function maintainerPersonJsonLd(locale: string): Record<string, unknown> {
  return {
    "@type": "Person",
    "@id": maintainerPersonId(),
    name: MAINTAINER_NAME,
    alternateName: ["yudai", "gomyway1216"],
    jobTitle:
      locale === "ja"
        ? "JTPA代表・ベイエリアAI勉強会サイト運営"
        : "JTPA representative and Bay Area AI Study Group site operator",
    url: absoluteLocalizedUrl(MAINTAINER_PROFILE_PATH, locale),
    sameAs: MAINTAINER_SAME_AS,
    affiliation: { "@id": siteOrganizationId() },
  };
}

export function siteIdentityJsonLd({
  locale,
  title,
  description,
}: {
  locale: string;
  title: string;
  description: string;
}): Record<string, unknown> {
  const base = siteBaseUrl();
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": siteOrganizationId(),
        name: "Bay Area AI Study Group",
        alternateName: ["ベイエリアAI勉強会", "JTPA"],
        url: base,
        logo: `${base}/images/logo_640_460.png`,
      },
      {
        "@type": "WebSite",
        "@id": siteWebsiteId(),
        name: title,
        alternateName: ["Bay Area AI Study Group", "ベイエリアAI勉強会", "JTPA"],
        url: absoluteLocalizedUrl("/", locale),
        description,
        inLanguage: locale,
        publisher: { "@id": siteOrganizationId() },
        creator: { "@id": maintainerPersonId() },
        maintainer: { "@id": maintainerPersonId() },
      },
      maintainerPersonJsonLd(locale),
    ],
  };
}

export function aboutPageJsonLd({
  locale,
  title,
  description,
}: {
  locale: string;
  title: string;
  description: string;
}): Record<string, unknown> {
  const url = absoluteLocalizedUrl("/about", locale);
  return {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "@id": `${url}#about-page`,
    url,
    name: title,
    description,
    inLanguage: locale,
    isPartOf: { "@id": siteWebsiteId() },
    about: { "@id": siteOrganizationId() },
    creator: { "@id": maintainerPersonId() },
    maintainer: { "@id": maintainerPersonId() },
  };
}

export function profilePageJsonLd({
  locale,
  profile,
  links,
  description,
  contributionCount,
  isMaintainer = false,
}: {
  locale: string;
  profile: PublicProfile;
  links: UserLinks;
  description?: string;
  contributionCount: number;
  isMaintainer?: boolean;
}): Record<string, unknown> {
  const path = isMaintainer
    ? MAINTAINER_PROFILE_PATH
    : publicProfilePathForUid(profile.uid);
  const pageUrl = absoluteLocalizedUrl(path, locale);
  const personId = isMaintainer ? maintainerPersonId() : `${pageUrl}#person`;
  const name = isMaintainer
    ? MAINTAINER_NAME
    : profile.fullName || `@${profile.username}`;
  const sameAs = uniqueUrls([
    ...(isMaintainer ? MAINTAINER_SAME_AS : []),
    ...linksToSameAs(links),
  ]);

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": `${pageUrl}#profile-page`,
    url: pageUrl,
    name: `${name} profile`,
    inLanguage: locale,
    mainEntity: {
      "@type": "Person",
      "@id": personId,
      identifier: profile.uid,
      name,
      alternateName: isMaintainer
        ? ["@yudai", "yudai", "gomyway1216"]
        : profile.fullName
          ? `@${profile.username}`
          : undefined,
      jobTitle: isMaintainer
        ? locale === "ja"
          ? "JTPA代表・ベイエリアAI勉強会サイト運営"
          : "JTPA representative and Bay Area AI Study Group site operator"
        : undefined,
      description,
      image: profile.photoURL ?? undefined,
      url: pageUrl,
      affiliation: isMaintainer ? { "@id": siteOrganizationId() } : undefined,
      ...(sameAs.length > 0 ? { sameAs } : {}),
      ...(contributionCount > 0
        ? {
            agentInteractionStatistic: {
              "@type": "InteractionCounter",
              interactionType: "https://schema.org/WriteAction",
              userInteractionCount: contributionCount,
            },
          }
        : {}),
    },
  };
}

export function authorPersonJsonLd({
  uid,
  locale,
  fallbackName,
  profile,
}: {
  uid: string;
  locale: string;
  fallbackName: string;
  profile?: PublicProfile | null;
}): Record<string, unknown> {
  const path = publicProfilePathForUid(uid);
  const isYudai = path === MAINTAINER_PROFILE_PATH;
  const links = isYudai ? MAINTAINER_LINKS : (profile?.links ?? {});
  const sameAs = uniqueUrls([
    ...(isYudai ? MAINTAINER_SAME_AS : []),
    ...linksToSameAs(links),
  ]);

  return {
    "@type": "Person",
    ...(isYudai ? { "@id": maintainerPersonId() } : {}),
    name: isYudai
      ? MAINTAINER_NAME
      : profile?.fullName || fallbackName || `@${profile?.username ?? uid}`,
    url: absoluteLocalizedUrl(path, locale),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}
