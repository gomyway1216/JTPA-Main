import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { getSessionUser } from "@/lib/auth/session";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getPostBySlug } from "@/lib/data/posts";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug).catch(() => null);
  if (!post || post.status !== "published") return {};
  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      images: post.coverImage ? [post.coverImage.url] : undefined,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);
  if (!post || post.status !== "published") notFound();

  // Session + comment listing are independent — kick them off together
  // rather than serially. The like-state query depends on the comment
  // ids so it stays after the join.
  const [user, comments] = await Promise.all([
    getSessionUser(),
    listComments("post", post.id).catch((err) => {
      console.error("Failed to list comments:", err);
      return [];
    }),
  ]);
  const likedSet = await getMyLikesForParent({
    parentType: "post",
    parentId: post.id,
    commentIds: comments.map((c) => c.id),
    uid: user?.uid ?? null,
  }).catch((err) => {
    console.error("Failed to load like state:", err);
    return new Set<string>();
  });

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <Link href="/blog" className="text-xs text-zinc-500 hover:underline">
        ← ブログ一覧
      </Link>

      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>
        <p className="text-sm text-zinc-500">
          by{" "}
          <Link
            href={`/u/${post.authorUid}`}
            className="hover:text-zinc-700 hover:underline dark:hover:text-zinc-300"
          >
            {post.authorName}
          </Link>
          {post.publishedAt && (
            <>
              {" · "}
              {formatDate(post.publishedAt)}
            </>
          )}
        </p>
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {post.tags.map((t) => (
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
            parentType="post"
            parentId={post.id}
            parentSlug={post.slug}
            initialLiked={likedSet.has(RECORD_LIKE_KEY)}
            initialCount={post.likeCount ?? 0}
            user={user}
          />
        </div>
      </header>

      {post.coverImage?.url && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={post.coverImage.url}
          alt={`${post.title} のカバー画像`}
          className="w-full rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      <MarkdownBody source={post.body} />

      {/* key={post.id} forces a fresh instance per post so local state
          (draft text, optimistic comment list) doesn't leak when the
          user navigates between two posts via the soft router. */}
      <CommentsSection
        key={post.id}
        parentType="post"
        parentId={post.id}
        parentSlug={post.slug}
        initialComments={comments}
        initialLikedKeys={[...likedSet]}
        user={user}
      />
    </article>
  );
}
