import type { Metadata } from "next";
import Link from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { JsonLd } from "@/components/seo/JsonLd";
import { getSitePageCached } from "@/lib/data/cached";
import {
  MAINTAINER_NAME,
  MAINTAINER_PROFILE_PATH,
  MAINTAINER_SOURCE_CODE_URL,
} from "@/lib/maintainer";
import {
  aboutPageJsonLd,
  absoluteLocalizedUrl,
  localizedAlternates,
} from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const [page, t] = await Promise.all([
    getSitePageCached("about"),
    getTranslations({ locale, namespace: "AboutPage" }),
  ]);
  const title = page?.title || t("defaultTitle");
  const description = t("metadataDescription");
  return {
    title,
    description,
    alternates: localizedAlternates("/about", locale),
    openGraph: {
      title,
      description,
      url: absoluteLocalizedUrl("/about", locale),
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations("AboutPage");
  // Served from the shared data cache; the admin save action invalidates
  // the `site-pages` tag so edits appear immediately on this instance and
  // within CONTENT_REVALIDATE_SECONDS everywhere else.
  const page = await getSitePageCached("about");
  const title = page?.title || t("defaultTitle");
  const body = page?.body || t("defaultBody");
  const description = t("metadataDescription");
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-6">
      <JsonLd
        data={aboutPageJsonLd({
          locale,
          title,
          description,
        })}
      />
      <h1 className="text-3xl font-bold">{title}</h1>
      <MarkdownBody source={body} />
      {/*
        Maintainer section pinned below the editable about Markdown.
        Kept in the source code (not in `sitePages/about`) so the
        attribution survives an admin who edits the about content and
        forgets to copy this footer over — and so the link can be a
        styled anchor (the MarkdownBody renderer escapes raw HTML).

        The name links to the maintainer's canonical public profile, which
        also carries the Person/ProfilePage structured data used by crawlers.
      */}
      <section className="border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
        <h2 className="mb-2 font-semibold text-zinc-700 dark:text-zinc-300">
          {t("maintainer")}
        </h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t.rich("maintainerText", {
            name: (chunks) => (
              <Link
                href={MAINTAINER_PROFILE_PATH}
                className="text-blue-600 hover:underline"
              >
                {chunks || MAINTAINER_NAME}
              </Link>
            ),
          })}
        </p>
        {/*
          Light call-to-action pointing at the /help feedback form for
          questions / bug reports / suggestions. Kept inside the
          maintainer block (rather than spun into its own section) so
          it reads as "the person who maintains this is reachable"
          rather than a generic "contact us" panel.
        */}
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {t("feedbackPrefix")}{" "}
          <Link
            href="/help#feedback"
            className="text-blue-600 hover:underline"
          >
            {t("feedbackLink")}
          </Link>{" "}
          {t("feedbackSuffix")}
        </p>
        {/*
          Quiet source-code link. Not a feature — just discoverability
          for anyone curious "who wrote this / how does it work". Keeps
          the maintainer attribution honest (the work IS in the open)
          without leaning self-promotional.
        */}
        <p className="mt-2 text-xs text-zinc-500">
          {t("sourceCode")}{" "}
          <a
            href={MAINTAINER_SOURCE_CODE_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="hover:underline"
          >
            github.com/gomyway1216/JTPA-Main →
          </a>
        </p>
      </section>
    </div>
  );
}
