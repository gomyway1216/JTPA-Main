import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { PollVoteForm } from "@/app/[locale]/poll/_components/PollVoteForm";
import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { getSessionUser } from "@/lib/auth/session";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getMyPollVote, getPollBySlug } from "@/lib/data/poll";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { formatDate, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const poll = await getPollBySlug(slug).catch(() => null);
  if (!poll || poll.status !== "published") return {};
  const description = poll.description
    ? truncate(poll.description, 160)
    : `${poll.options.map((o) => o.label).join(" / ")}`;
  return {
    title: poll.title,
    description,
    openGraph: { title: poll.title, description },
  };
}

export default async function PollDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [locale, t, common] = await Promise.all([
    getLocale(),
    getTranslations("PollDetail"),
    getTranslations("Common"),
  ]);
  const [user, poll] = await Promise.all([
    getSessionUser(),
    getPollBySlug(slug),
  ]);
  if (!poll) notFound();
  const isAuthorOrAdmin =
    !!user && (user.uid === poll.authorUid || user.isAdmin);
  if (poll.status !== "published" && !isAuthorOrAdmin) {
    // Match the Q&A behavior: don't leak whether the slug exists.
    notFound();
  }

  const [comments, myVote] = await Promise.all([
    listComments("poll", poll.id).catch((err) => {
      console.error("Failed to list poll comments:", err);
      return [];
    }),
    getMyPollVote(poll.id, user?.uid ?? null).catch((err) => {
      console.error("Failed to load my poll vote:", err);
      return null;
    }),
  ]);
  const likedSet = await getMyLikesForParent({
    parentType: "poll",
    parentId: poll.id,
    commentIds: comments.map((c) => c.id),
    uid: user?.uid ?? null,
  }).catch((err) => {
    console.error("Failed to load poll like state:", err);
    return new Set<string>();
  });
  // Batched profile read covering the poll author + every commenter.
  // Map → plain object for the (Client) CommentsSection crossing.
  const profilesByUid = await getPublicProfilesByUids([
    poll.authorUid,
    ...comments.map((c) => c.authorUid),
  ]);

  const canEdit = isAuthorOrAdmin;
  const initialSelectedIds = myVote?.optionIds ?? [];

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <Link href="/poll" className="text-xs text-zinc-500 hover:underline">
        {t("back")}
      </Link>

      {poll.status === "archived" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t("archivedNoticePrefix")} <strong>{t("archived")}</strong>{" "}
          {t("archivedNoticeSuffix")}
        </div>
      )}

      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{poll.title}</h1>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-zinc-500">
          <AuthorBadge
            profile={profilesByUid.get(poll.authorUid) ?? null}
            size="md"
          />
          <span>· {formatDate(poll.createdAt, locale)}</span>
        </p>
        <div className="flex items-center gap-3">
          <LikeButton
            target="record"
            parentType="poll"
            parentId={poll.id}
            parentSlug={poll.slug}
            initialLiked={likedSet.has(RECORD_LIKE_KEY)}
            initialCount={poll.likeCount ?? 0}
            user={user}
          />
          {canEdit && (
            <Link
              href={`/poll/${poll.slug}/edit`}
              className="text-xs text-zinc-600 hover:underline dark:text-zinc-400"
            >
              {common("edit")}
            </Link>
          )}
        </div>
      </header>

      {poll.description && (
        <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {poll.description}
        </p>
      )}

      {/*
        Both children are keyed on poll.id to force a fresh mount when the
        route swaps to a different poll (Next.js client navigation otherwise
        keeps the existing component instance and its useState, leaking the
        previous poll's options/voterCount/draft into the new page until
        the user interacts). The keys must be PREFIXED to be unique among
        siblings — when two siblings share the same key, React's reconciler
        misroutes the second one during the RSC merge that follows a Server
        Action's `revalidatePath` call (e.g. clicking the like button), and
        re-renders the form as a sibling of itself instead of replacing it.
        See issue #75.
      */}
      <PollVoteForm
        key={`vote-${poll.id}`}
        pollId={poll.id}
        pollSlug={poll.slug}
        initialOptions={poll.options}
        initialSelectedIds={initialSelectedIds}
        initialVoterCount={poll.voterCount ?? 0}
        user={user}
      />

      <CommentsSection
        key={`comments-${poll.id}`}
        parentType="poll"
        parentId={poll.id}
        parentSlug={poll.slug}
        initialComments={comments}
        initialLikedKeys={[...likedSet]}
        profilesByUid={Object.fromEntries(profilesByUid)}
        user={user}
      />
    </article>
  );
}
