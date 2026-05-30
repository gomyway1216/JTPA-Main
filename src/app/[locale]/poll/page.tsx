import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { EmptyState } from "@/components/ui/EmptyState";
import { FadeUp } from "@/components/ui/FadeUp";
import { interactiveCardClass } from "@/components/ui/surface";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { loginHref } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { listPoll } from "@/lib/data/poll";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { formatDate, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("PollPage");
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function PollListPage() {
  const locale = await getLocale();
  const t = await getTranslations("PollPage");
  const [user, items] = await Promise.all([
    getSessionUser(),
    listPoll({ statuses: ["published"], limit: 50 }).catch((err) => {
      console.error("Failed to list polls:", err);
      return [];
    }),
  ]);
  const authorProfiles = await getPublicProfilesByUids(
    items.map((p) => p.authorUid),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-8">
      {/* Stack on mobile — same rationale as /blog, /guide, /qa. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
        {user ? (
          <Link
            href="/poll/new"
            className="w-fit shrink-0 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t("submit")}
          </Link>
        ) : (
          <Link
            href={loginHref("/poll/new", locale)}
            className="w-fit shrink-0 rounded-full border border-zinc-300/70 px-5 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700/70 dark:hover:bg-zinc-800"
          >
            {t("loginSubmit")}
          </Link>
        )}
      </header>

      {items.length === 0 ? (
        <EmptyState
          message={t("empty")}
          hint={t("emptyHint")}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((p, i) => {
            // Show the top 2 option labels in the list preview so the
            // reader can guess the topic without opening the detail.
            const topOptions = [...p.options]
              .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0))
              .slice(0, 2);
            return (
              <FadeUp
                key={p.id}
                as="li"
                delay={i}
                className={`${interactiveCardClass} relative flex flex-col p-5 focus-within:ring-2 focus-within:ring-indigo-500`}
              >
                <h2 className="text-lg font-semibold">
                  <Link
                    href={`/poll/${p.slug}`}
                    className="after:absolute after:inset-0 focus:outline-none"
                  >
                    {p.title}
                  </Link>
                </h2>
                <p className="relative z-10 mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-zinc-500">
                  <AuthorBadge profile={authorProfiles.get(p.authorUid) ?? null} />
                  <span>
                    · {formatDate(p.createdAt, locale)} ·{" "}
                    {t("voterCount", { count: p.voterCount ?? 0 })}
                  </span>
                  {(p.likeCount ?? 0) > 0 && (
                    <span className="ml-2 text-rose-600">♥ {p.likeCount}</span>
                  )}
                </p>
                {p.description && (
                  <p className="mt-2 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {truncate(p.description, 160)}
                  </p>
                )}
                <p className="mt-2 text-xs text-zinc-500">
                  {t("optionCount", { count: p.options.length })}
                  {topOptions.length > 0 && (
                    <> · {topOptions.map((o) => o.label).join(" / ")}…</>
                  )}
                </p>
              </FadeUp>
            );
          })}
        </ul>
      )}
    </div>
  );
}
