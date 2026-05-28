import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { getSessionUser } from "@/lib/auth/session";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getGuideBySlug } from "@/lib/data/guides";
import { formatDate, stripMarkdown, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const guide = await getGuideBySlug(slug).catch(() => null);
  if (!guide || guide.status !== "published") return {};
  const description = truncate(stripMarkdown(guide.body), 160);
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

  const tags = guide.tags ?? [];

  const user = await getSessionUser();
  const comments = await listComments("guide", guide.id).catch((err) => {
    console.error("Failed to list guide comments:", err);
    return [];
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

      <MarkdownBody source={guide.body} />

      <CommentsSection
        key={guide.id}
        parentType="guide"
        parentId={guide.id}
        parentSlug={guide.slug}
        initialComments={comments}
        initialLikedKeys={[...likedSet]}
        user={user}
      />
    </article>
  );
}
