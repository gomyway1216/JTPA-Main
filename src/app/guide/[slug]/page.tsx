import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { getSessionUser } from "@/lib/auth/session";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getGuideBySlug } from "@/lib/data/guides";
import { getPublicProfilesByUids } from "@/lib/data/users";
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
  // Session + record load are independent — kick them off together
  // rather than serially. We need the user for the access check below.
  const [user, guide] = await Promise.all([
    getSessionUser(),
    getGuideBySlug(slug),
  ]);
  if (!guide) notFound();

  // Non-published guides are reachable via this route for admin / editor
  // (cross-author preview, e.g. clicking プレビュー from /admin/guides
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

  const tags = guide.tags ?? [];

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
  // Guides have no rendered author surface (admin/editor-curated, see
  // the GuideDoc type), but the comments thread does, so batch-fetch
  // for every commenter the same way the post/qa/poll pages do.
  const profilesByUid = await getPublicProfilesByUids(
    comments.map((c) => c.authorUid),
  );

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <Link href="/guide" className="text-xs text-zinc-500 hover:underline">
        ← ガイド一覧
      </Link>

      {guide.status !== "published" && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          このガイドは現在{" "}
          <strong>
            {guide.status === "pending"
              ? "審査待ち"
              : guide.status === "rejected"
                ? "却下"
                : guide.status === "archived"
                  ? "アーカイブ"
                  : "下書き"}
          </strong>{" "}
          状態です。一般公開はされておらず、投稿者と管理者・エディタのみが閲覧できます。
        </div>
      )}

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
        profilesByUid={Object.fromEntries(profilesByUid)}
        user={user}
      />
    </article>
  );
}
