import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { getSessionUser } from "@/lib/auth/session";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getQaBySlug } from "@/lib/data/qa";
import { formatDate, stripMarkdown, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const qa = await getQaBySlug(slug).catch(() => null);
  if (!qa || qa.status !== "published") return {};
  const description = truncate(stripMarkdown(qa.body), 160);
  return {
    title: qa.title,
    description,
    openGraph: { title: qa.title, description },
  };
}

export default async function QaDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const qa = await getQaBySlug(slug);
  // Drafts/archived are not reachable from public — same treatment as
  // unpublished posts/guides.
  if (!qa || qa.status !== "published") notFound();

  // Session + comment listing are independent — kick them off together
  // rather than serially. The like-state query depends on the comment
  // ids so it stays after the join.
  const [user, comments] = await Promise.all([
    getSessionUser(),
    listComments("qa", qa.id).catch((err) => {
      console.error("Failed to list Q&A comments:", err);
      return [];
    }),
  ]);
  const likedSet = await getMyLikesForParent({
    parentType: "qa",
    parentId: qa.id,
    commentIds: comments.map((c) => c.id),
    uid: user?.uid ?? null,
  }).catch((err) => {
    console.error("Failed to load Q&A like state:", err);
    return new Set<string>();
  });

  const canEdit = !!user && (user.uid === qa.authorUid || user.isAdmin);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <Link href="/qa" className="text-xs text-zinc-500 hover:underline">
        ← Q&amp;A 一覧
      </Link>

      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{qa.title}</h1>
        <p className="text-sm text-zinc-500">
          by {qa.authorName} · {formatDate(qa.createdAt)}
        </p>
        {qa.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {qa.tags.map((t) => (
              <span
                key={t}
                className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <LikeButton
            target="record"
            parentType="qa"
            parentId={qa.id}
            parentSlug={qa.slug}
            initialLiked={likedSet.has(RECORD_LIKE_KEY)}
            initialCount={qa.likeCount ?? 0}
            user={user}
          />
          {canEdit && (
            <Link
              href={`/qa/${qa.slug}/edit`}
              className="text-xs text-zinc-600 hover:underline dark:text-zinc-400"
            >
              編集
            </Link>
          )}
        </div>
      </header>

      <MarkdownBody source={qa.body} />

      <CommentsSection
        key={qa.id}
        parentType="qa"
        parentId={qa.id}
        parentSlug={qa.slug}
        initialComments={comments}
        initialLikedKeys={[...likedSet]}
        user={user}
      />
    </article>
  );
}
