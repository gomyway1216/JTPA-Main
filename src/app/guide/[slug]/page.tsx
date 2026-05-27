import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { getGuideBySlug } from "@/lib/data/guides";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Same light Markdown strip used on the index page so the SEO description
// stays readable. Imports would create a server/client dependency cycle
// otherwise.
function plainExcerpt(body: string, max = 160): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = await getGuideBySlug(slug).catch(() => null);
  if (!guide || guide.status !== "published") return {};
  const description = plainExcerpt(guide.body);
  return {
    title: guide.title,
    description,
    openGraph: {
      title: guide.title,
      description,
    },
  };
}

export default async function GuideDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = await getGuideBySlug(slug);
  // Drafts are reachable only from the admin UI — for the public route,
  // treat anything not currently published as a missing page so we don't
  // leak in-progress content via guessed slugs.
  if (!guide || guide.status !== "published") notFound();

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <Link href="/guide" className="text-xs text-zinc-500 hover:underline">
        ← ガイド一覧
      </Link>

      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{guide.title}</h1>
        <p className="text-xs text-zinc-500">
          最終更新: {formatDate(guide.updatedAt)}
        </p>
        {guide.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {guide.tags.map((t) => (
              <span
                key={t}
                className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </header>

      <MarkdownBody source={guide.body} />
    </article>
  );
}
