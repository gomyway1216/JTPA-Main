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
    </div>
  );
}
