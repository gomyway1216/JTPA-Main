import type { Metadata } from "next";

import { localizedPath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { siteBaseUrl } from "@/lib/site";

export function localizedAlternates(
  path: string,
  locale: string,
): Metadata["alternates"] {
  const languages = Object.fromEntries(
    routing.locales.map((candidate) => [
      candidate,
      localizedPath(path, candidate),
    ]),
  );

  return {
    canonical: localizedPath(path, locale),
    languages: {
      ...languages,
      "x-default": localizedPath(path, routing.defaultLocale),
    },
  };
}

export function absoluteLocalizedUrl(path: string, locale: string): string {
  return `${siteBaseUrl()}${localizedPath(path, locale)}`;
}
