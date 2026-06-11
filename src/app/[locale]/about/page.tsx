import type { Metadata } from "next";
import Link from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { getSitePageCached } from "@/lib/data/cached";

// Yudai's JTPA uid. Hardcoded because the maintainer attribution is
// a specific, stable individual — using an env var or DB lookup would
// be overhead for a one-name credit that effectively never changes.
// If maintainership ever transfers, update this constant (and remove
// the comment).
const MAINTAINER_UID = "FQe7JWGETbTm9w9sAZgacemC1aC3";

export async function generateMetadata(): Promise<Metadata> {
  const [page, t] = await Promise.all([
    getSitePageCached("about"),
    getTranslations("AboutPage"),
  ]);
  return { title: page?.title || t("defaultTitle") };
}

export default async function AboutPage() {
  const t = await getTranslations("AboutPage");
  // Served from the shared data cache; the admin save action invalidates
  // the `site-pages` tag so edits appear immediately on this instance and
  // within CONTENT_REVALIDATE_SECONDS everywhere else.
  const page = await getSitePageCached("about");
  const title = page?.title || t("defaultTitle");
  const body = page?.body || t("defaultBody");
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-6">
      <h1 className="text-3xl font-bold">{title}</h1>
      <MarkdownBody source={body} />
      {/*
        Maintainer section pinned below the editable about Markdown.
        Kept in the source code (not in `sitePages/about`) so the
        attribution survives an admin who edits the about content and
        forgets to copy this footer over — and so the link can be a
        styled anchor (the MarkdownBody renderer escapes raw HTML).

        The name links to the maintainer's public JTPA profile
        (/u/[uid]) — that page in turn exposes whatever external links
        the user has chosen to publish (portfolio, GitHub, …) via
        /my/profile, so we don't hardcode meetyudai.com here.
      */}
      <section className="border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
        <h2 className="mb-2 font-semibold text-zinc-700 dark:text-zinc-300">
          {t("maintainer")}
        </h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t.rich("maintainerText", {
            name: (chunks) => (
              <Link
                href={`/u/${MAINTAINER_UID}`}
                className="text-blue-600 hover:underline"
              >
                {chunks}
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
            href="https://github.com/gomyway1216/JTPA-Main"
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
