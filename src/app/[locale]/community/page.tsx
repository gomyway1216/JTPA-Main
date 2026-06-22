import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import {
  CommunityFeed,
  type CommunityFeedItem,
} from "@/app/[locale]/community/_components/CommunityFeed";
import { loginHref } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { listGuides } from "@/lib/data/guides";
import { listPoll } from "@/lib/data/poll";
import { listPublishedPostsForLocale } from "@/lib/data/posts";
import { listQa } from "@/lib/data/qa";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { getLocalizedPostContent } from "@/lib/localized-content";
import type { GuideDoc, PollDoc, PostDoc, QaDoc, TsLike } from "@/lib/types";
import { formatDate, stripMarkdown, toDate, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CommunityPage");
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function CommunityPage() {
  const [locale, t, user] = await Promise.all([
    getLocale(),
    getTranslations("CommunityPage"),
    getSessionUser(),
  ]);
  const [guides, qaItems, polls, posts] = await Promise.all([
    listGuides({ statuses: ["published"], limit: 40 }).catch((err) => {
      console.error("Failed to list guides for community:", err);
      return [] as GuideDoc[];
    }),
    listQa({ statuses: ["published"], limit: 40 }).catch((err) => {
      console.error("Failed to list Q&A for community:", err);
      return [] as QaDoc[];
    }),
    listPoll({ statuses: ["published"], limit: 40 }).catch((err) => {
      console.error("Failed to list polls for community:", err);
      return [] as PollDoc[];
    }),
    listPublishedPostsForLocale(locale, 40).catch((err) => {
      console.error("Failed to list posts for community:", err);
      return [] as PostDoc[];
    }),
  ]);

  const uids = [
    ...guides.map((g) => g.authorUid ?? g.createdBy.uid),
    ...qaItems.map((q) => q.authorUid),
    ...polls.map((p) => p.authorUid),
    ...posts.map((p) => p.authorUid),
  ];
  const authorProfiles = await getPublicProfilesByUids(uids).catch((err) => {
    console.error("Failed to list community author profiles:", err);
    return new Map();
  });

  const items = [
    ...guides.map((guide) => guideItem(guide, locale, authorProfiles)),
    ...qaItems.map((qa) => qaItem(qa, locale, authorProfiles)),
    ...polls.map((poll) => pollItem(poll, locale, authorProfiles)),
    ...posts.map((post) => postItem(post, locale, authorProfiles)),
  ]
    .sort((a, b) => b.sortTime - a.sortTime)
    .slice(0, 80);

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <header className="flex flex-col gap-4 border-b border-zinc-200 pb-5 sm:flex-row sm:items-end sm:justify-between dark:border-zinc-800">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <ActionLink
            href={user ? "/qa/new" : loginHref("/qa/new", locale)}
            primary
          >
            {t("actions.qa")}
          </ActionLink>
          <ActionLink href={user ? "/guide/new" : loginHref("/guide/new", locale)}>
            {t("actions.guide")}
          </ActionLink>
          <ActionLink href={user ? "/poll/new" : loginHref("/poll/new", locale)}>
            {t("actions.poll")}
          </ActionLink>
        </div>
      </header>

      <CommunityFeed items={items} />
    </div>
  );
}

function ActionLink({
  href,
  primary = false,
  children,
}: {
  href: string;
  primary?: boolean;
  children: React.ReactNode;
}) {
  const className = primary
    ? "rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
    : "rounded-md border border-zinc-300/70 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700/70 dark:hover:bg-zinc-800";

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function guideItem(
  guide: GuideDoc,
  locale: string,
  authorProfiles: Awaited<ReturnType<typeof getPublicProfilesByUids>>,
): CommunityFeedItem {
  const authorUid = guide.authorUid ?? guide.createdBy.uid;
  const date = guide.publishedAt ?? guide.updatedAt ?? guide.createdAt;
  return baseItem({
    id: guide.id,
    kind: "guide",
    href: `/guide/${guide.slug}`,
    title: guide.title,
    excerpt: truncate(stripMarkdown(guide.body), 180),
    tags: guide.tags,
    date,
    locale,
    authorProfile: authorProfiles.get(authorUid) ?? null,
    likeCount: guide.likeCount,
  });
}

function qaItem(
  qa: QaDoc,
  locale: string,
  authorProfiles: Awaited<ReturnType<typeof getPublicProfilesByUids>>,
): CommunityFeedItem {
  return baseItem({
    id: qa.id,
    kind: "qa",
    href: `/qa/${qa.slug}`,
    title: qa.title,
    excerpt: truncate(stripMarkdown(qa.body), 180),
    tags: qa.tags,
    date: qa.createdAt,
    locale,
    authorProfile: authorProfiles.get(qa.authorUid) ?? null,
    likeCount: qa.likeCount,
  });
}

function pollItem(
  poll: PollDoc,
  locale: string,
  authorProfiles: Awaited<ReturnType<typeof getPublicProfilesByUids>>,
): CommunityFeedItem {
  const topOptions = [...poll.options]
    .sort((a, b) => (b.voteCount ?? 0) - (a.voteCount ?? 0))
    .slice(0, 2)
    .map((option) => option.label);

  return baseItem({
    id: poll.id,
    kind: "poll",
    href: `/poll/${poll.slug}`,
    title: poll.title,
    excerpt: poll.description ? truncate(poll.description, 160) : "",
    tags: topOptions,
    date: poll.createdAt,
    locale,
    authorProfile: authorProfiles.get(poll.authorUid) ?? null,
    likeCount: poll.likeCount,
    voterCount: poll.voterCount,
    optionCount: poll.options.length,
  });
}

function postItem(
  post: PostDoc,
  locale: string,
  authorProfiles: Awaited<ReturnType<typeof getPublicProfilesByUids>>,
): CommunityFeedItem {
  const content = getLocalizedPostContent(post, locale);
  return baseItem({
    id: post.id,
    kind: "blog",
    href: `/blog/${post.slug}`,
    title: content.title,
    excerpt: content.excerpt || truncate(stripMarkdown(content.body), 180),
    tags: post.tags,
    date: post.publishedAt ?? post.createdAt,
    locale,
    authorProfile: authorProfiles.get(post.authorUid) ?? null,
    likeCount: post.likeCount,
  });
}

function baseItem({
  id,
  kind,
  href,
  title,
  excerpt,
  tags,
  date,
  locale,
  authorProfile,
  likeCount,
  voterCount,
  optionCount,
}: Omit<CommunityFeedItem, "dateLabel" | "sortTime"> & {
  date: TsLike | undefined;
  locale: string;
}): CommunityFeedItem {
  return {
    id,
    kind,
    href,
    title,
    excerpt,
    tags,
    authorProfile,
    likeCount,
    voterCount,
    optionCount,
    dateLabel: formatDate(date, locale),
    sortTime: toDate(date)?.getTime() ?? 0,
  };
}
