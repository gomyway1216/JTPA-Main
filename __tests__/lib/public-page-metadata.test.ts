import { afterEach, describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import ja from "../../messages/ja.json";
import { publicPageMetadata } from "@/lib/public-page-metadata";

vi.mock("next-intl/server", () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: "EventsPage" | "BlogPage" | "GuidePage" | "CommunityPage" | "QaPage" | "PollPage" }) => {
    const messages = locale === "ja" ? ja : en;
    return (key: "metadataTitle" | "metadataDescription") => messages[namespace][key];
  },
}));

afterEach(() => vi.unstubAllEnvs());

describe("public listing metadata", () => {
  const pages = [
    ["/events", "EventsPage"],
    ["/blog", "BlogPage"],
    ["/guide", "GuidePage"],
    ["/community", "CommunityPage"],
    ["/qa", "QaPage"],
    ["/poll", "PollPage"],
  ] as const;

  for (const locale of ["ja", "en"] as const) {
    it.each(pages)(`gives %s its own localized metadata in ${locale}`, async (path, namespace) => {
      vi.stubEnv("SITE_URL", "https://bayarea-ai.com");
      vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
      const metadata = await publicPageMetadata(path, locale);
      const copy = (locale === "ja" ? ja : en)[namespace];
      expect(copy.metadataTitle.length).toBeGreaterThan(10);
      expect(copy.metadataDescription.length).toBeGreaterThan(30);
      expect(metadata).toMatchObject({
        title: copy.metadataTitle,
        description: copy.metadataDescription,
        alternates: {
          canonical: `https://bayarea-ai.com/${locale}${path}`,
          languages: {
            ja: `https://bayarea-ai.com/ja${path}`,
            en: `https://bayarea-ai.com/en${path}`,
            "x-default": `https://bayarea-ai.com/ja${path}`,
          },
        },
        openGraph: {
          title: copy.metadataTitle,
          description: copy.metadataDescription,
          url: `https://bayarea-ai.com/${locale}${path}`,
        },
        twitter: { title: copy.metadataTitle, description: copy.metadataDescription },
      });
    });
  }
});
