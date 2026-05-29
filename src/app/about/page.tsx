import type { Metadata } from "next";

import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { getSitePage, SITE_PAGE_DEFAULTS } from "@/lib/data/site-pages";

export async function generateMetadata(): Promise<Metadata> {
  const page = await getSitePage("about");
  return { title: page?.title || SITE_PAGE_DEFAULTS.about.title };
}

export default async function AboutPage() {
  const page = await getSitePage("about");
  const title = page?.title || SITE_PAGE_DEFAULTS.about.title;
  const body = page?.body || SITE_PAGE_DEFAULTS.about.body;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-6">
      <h1 className="text-3xl font-bold">{title}</h1>
      <MarkdownBody source={body} />
      {/*
        Maintainer section pinned below the editable about Markdown.
        Kept in the source code (not in `sitePages/about`) so the
        attribution survives an admin who edits the about content and
        forgets to copy this footer over — and so the link to the
        portfolio uses a real anchor (the MarkdownBody renderer escapes
        raw HTML, so styling the link here would otherwise require
        round-tripping the URL into the Markdown).
      */}
      <section className="border-t border-zinc-200 pt-6 text-sm dark:border-zinc-800">
        <h2 className="mb-2 font-semibold text-zinc-700 dark:text-zinc-300">
          メンテナー
        </h2>
        <p className="text-zinc-600 dark:text-zinc-400">
          このサイトは{" "}
          <a
            href="https://meetyudai.com"
            target="_blank"
            rel="noreferrer noopener"
            className="text-blue-600 hover:underline"
          >
            Yudai Yaguchi
          </a>{" "}
          が開発・運用しています。
        </p>
      </section>
    </div>
  );
}
