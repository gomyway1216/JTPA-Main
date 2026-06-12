import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Image from "next/image";

import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { listApprovedProjectsCached } from "@/lib/data/cached";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { stripMarkdown } from "@/lib/utils";

// Per-request render (session-reading layout); the approved-project list
// is served from the shared data cache (src/lib/data/cached.ts).
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ShowcasePage");
  return { title: t("metadataTitle") };
}

export default async function ShowcasePage() {
  const t = await getTranslations("ShowcasePage");
  const common = await getTranslations("Common");
  const projects = await listApprovedProjectsCached(100).catch(() => []);
  // Batched profile lookup for every project owner shown in the grid;
  // missing entries fall back to "@unknown" so a deleted-owner project
  // still renders.
  const ownerProfiles = await getPublicProfilesByUids(
    projects.map((p) => p.ownerUid),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 space-y-8">
      {/* Stack on mobile so the H1 + subtitle get full width — the
          right-rail submit-project button squeezes them into a
          narrow column otherwise. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
        <Link
          href="/projects/new"
          className="w-fit shrink-0 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {t("submit")}
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p, i) => {
            // Cover image. Falls back to the first screenshot when the
            // submitter didn't upload a dedicated thumbnail.
            const cover = p.thumbnail?.url || p.screenshots?.[0]?.url;
            return (
              <FadeUp key={p.id} as="li" delay={i} className="flex">
                <Link
                  href={`/showcase/${p.slug}`}
                  className={`${interactiveCardClass} flex h-full w-full flex-col overflow-hidden`}
                >
                  {cover && (
                    <Image
                      src={cover}
                      alt={common("coverImageAlt", { title: p.title })}
                      width={1600}
                      height={900}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="aspect-[16/9] w-full object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="line-clamp-2 text-lg font-semibold">{p.title}</h3>
                    {/*
                      AuthorBadge instead of a hand-rolled `by @username`
                      so role pills (Admin / Editor / Contributor) and
                      opted-in real names propagate here too. `linkable=
                      false` because the card itself is already a single
                      big `<Link>` to /showcase/[slug] — a nested anchor
                      would be invalid HTML.
                    */}
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                      <span>{t("by")}</span>
                      <AuthorBadge
                        profile={ownerProfiles.get(p.ownerUid) ?? null}
                        linkable={false}
                      />
                    </p>
                    <p className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                      {stripMarkdown(p.description)}
                    </p>
                    {p.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {p.tags.slice(0, 4).map((t) => (
                          <span
                            key={t}
                            className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              </FadeUp>
            );
          })}
        </ul>
      )}
    </div>
  );
}
