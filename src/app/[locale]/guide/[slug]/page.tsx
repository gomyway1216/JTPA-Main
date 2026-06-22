import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { getSessionUser } from "@/lib/auth/session";
import { getGuideBySlugCached } from "@/lib/data/cached";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { getLocalizedGuideContent } from "@/lib/localized-content";
import { formatDate, stripMarkdown, truncate } from "@/lib/utils";

// Per-request render (session-based draft preview, like state, comments
// stay fresh); only the guide document is served from the data cache.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [locale, guide] = await Promise.all([
    getLocale(),
    getGuideBySlugCached(slug).catch(() => null),
  ]);
  if (!guide || guide.status !== "published") return {};
  const content = getLocalizedGuideContent(guide, locale);
  const description = truncate(stripMarkdown(content.body), 160);
  return {
    title: content.title,
    description,
    openGraph: {
      title: content.title,
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
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("GuideDetail"),
  ]);
  // Session + record load are independent — kick them off together
  // rather than serially. We need the user for the access check below.
  const [user, guide] = await Promise.all([
    getSessionUser(),
    getGuideBySlugCached(slug),
  ]);
  if (!guide) notFound();

  // Non-published guides are reachable via this route for admin / editor
  // (cross-author preview, e.g. clicking preview from /admin/guides
  // pending queue) AND the author themselves (so an author can preview
  // their draft / pending / rejected guide via /my/guides). Anonymous
  // visitors and other signed-in users see the same 404 they would for
  // a non-existent slug — don't leak that the slug exists. Mirrors the
  // /qa/[slug] pattern.
  const ownerUid = guide.authorUid ?? guide.createdBy?.uid;
  const isAuthorOrCurator =
    !!user && (user.isAdmin || user.isEditor || user.uid === ownerUid);
  if (guide.status !== "published" && !isAuthorOrCurator) {
    notFound();
  }
  const content = getLocalizedGuideContent(guide, locale);

  const tags = guide.tags ?? [];
  const statusLabel =
    guide.status === "pending"
      ? t("status.pending")
      : guide.status === "rejected"
        ? t("status.rejected")
        : guide.status === "archived"
          ? t("status.archived")
          : t("status.draft");

  const { comments, nextCursor: commentsNextCursor } = await listComments(
    "guide",
    guide.id,
  ).catch((err) => {
    console.error("Failed to list guide comments:", err);
    return { comments: [], nextCursor: null };
  });
  const likedSet = await getMyLikesForParent({
    parentType: "guide",
    parentId: guide.id,
    commentIds: comments.map((c) => c.id),
    uid: user?.uid ?? null,
  }).catch((err) => {
    console.error("Failed to load guide like state:", err);
    return new Set<string>();
  });
  // Guides have no rendered author surface (admin/editor-curated, see
  // the GuideDoc type), but the comments thread does, so batch-fetch
  // for every commenter the same way the post/qa/poll pages do.
  const profilesByUid = await getPublicProfilesByUids(
    comments.map((c) => c.authorUid),
  );

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <Link href="/guide" className="text-xs text-zinc-500 hover:underline">
        {t("back")}
      </Link>

      {guide.status !== "published" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t("statusNoticePrefix")} <strong>{statusLabel}</strong>{" "}
          {t("statusNoticeSuffix")}
        </div>
      )}

      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{content.title}</h1>
        <p className="text-xs text-zinc-500">
          {t("lastUpdated", { date: formatDate(guide.updatedAt, locale) })}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <span
                key={t}
                className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div>
          <LikeButton
            target="record"
            parentType="guide"
            parentId={guide.id}
            parentSlug={guide.slug}
            initialLiked={likedSet.has(RECORD_LIKE_KEY)}
            initialCount={guide.likeCount ?? 0}
            user={user}
          />
        </div>
      </header>

      <MarkdownBody source={content.body} />

      <CommentsSection
        key={guide.id}
        parentType="guide"
        parentId={guide.id}
        parentSlug={guide.slug}
        initialComments={comments}
        initialNextCursor={commentsNextCursor}
        initialLikedKeys={[...likedSet]}
        profilesByUid={Object.fromEntries(profilesByUid)}
        user={user}
      />
    </article>
  );
}
