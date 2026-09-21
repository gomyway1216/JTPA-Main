import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { absoluteLocalizedUrl, localizedAlternates } from "@/lib/seo";

const namespaces = {
  "/events": "EventsPage",
  "/blog": "BlogPage",
  "/guide": "GuidePage",
  "/community": "CommunityPage",
  "/qa": "QaPage",
  "/poll": "PollPage",
} as const;

export async function publicPageMetadata(
  path: keyof typeof namespaces,
  locale: string,
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: namespaces[path] });
  const title = t("metadataTitle");
  const description = t("metadataDescription");

  return {
    title,
    description,
    alternates: localizedAlternates(path, locale),
    openGraph: {
      type: "website",
      title,
      description,
      url: absoluteLocalizedUrl(path, locale),
    },
    twitter: { card: "summary", title, description },
  };
}
