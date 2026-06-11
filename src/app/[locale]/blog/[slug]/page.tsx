import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import Image from "next/image";
import { notFound } from "next/navigation";

import { CommentsSection } from "@/components/comments/CommentsSection";
import { LikeButton } from "@/components/likes/LikeButton";
import { MarkdownBody } from "@/components/markdown/MarkdownBody";
import { JsonLd } from "@/components/seo/JsonLd";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { getSessionUser } from "@/lib/auth/session";
import { getPostBySlugCached } from "@/lib/data/cached";
import { listComments } from "@/lib/data/comments";
import { getMyLikesForParent, RECORD_LIKE_KEY } from "@/lib/data/likes";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { formatDate, toDate } from "@/lib/utils";

// Per-request render (session, like state, comments stay fresh); only the
// post document itself is served from the shared data cache.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPostBySlugCached(slug).catch(() => null);
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
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("BlogDetail"),
  ]);
  const post = await getPostBySlugCached(slug);
  if (!post || post.status !== "published") notFound();

  // Session + comment listing are independent — kick them off together
  // rather than serially. The like-state query depends on the comment
  // ids so it stays after the join.
  const [user, commentsPage] = await Promise.all([
    getSessionUser(),
    listComments("post", post.id).catch((err) => {
      console.error("Failed to list comments:", err);
      return { comments: [], nextCursor: null };
    }),
  ]);
  const { comments, nextCursor: commentsNextCursor } = commentsPage;
  const likedSet = await getMyLikesForParent({
    parentType: "post",
    parentId: post.id,
    commentIds: comments.map((c) => c.id),
    uid: user?.uid ?? null,
  }).catch((err) => {
    console.error("Failed to load like state:", err);
    return new Set<string>();
  });

  // One batched read covering the post author + every commenter. The
  // resulting map is consumed twice: directly here for the header
  // badge, and again as a plain object for the (Client) CommentsSection
  // — Map doesn't survive the RSC→Client serialization boundary so we
  // convert with Object.fromEntries below.
  const profilesByUid = await getPublicProfilesByUids([
    post.authorUid,
    ...comments.map((c) => c.authorUid),
  ]);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      {/* schema.org/BlogPosting structured data. `undefined` fields
          (missing publish date / cover) are dropped by JSON.stringify
          inside JsonLd, and toISOString() emits ISO 8601 UTC. */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BlogPosting",
          headline: post.title,
          description: post.excerpt,
          datePublished: toDate(post.publishedAt)?.toISOString(),
          author: { "@type": "Person", name: post.authorName },
          image: post.coverImage ? [post.coverImage.url] : undefined,
        }}
      />

      <Link href="/blog" className="text-xs text-zinc-500 hover:underline">
        {t("back")}
      </Link>

      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-zinc-500">
          <AuthorBadge
            profile={profilesByUid.get(post.authorUid) ?? null}
            size="md"
          />
          {post.publishedAt && (
            <span>· {formatDate(post.publishedAt, locale)}</span>
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
        // The source ratio is whatever the author uploaded; width/height
        // only pre-reserve a 16:9 box while loading — Tailwind preflight's
        // `img { height: auto }` keeps the rendered height tracking the
        // real ratio at full width, exactly like the old raw <img>.
        // `preload`: the cover is the LCP element on posts that have one.
        <Image
          src={post.coverImage.url}
          alt={t("coverAlt", { title: post.title })}
          width={1600}
          height={900}
          preload
          sizes="(max-width: 768px) 100vw, 736px"
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
        initialNextCursor={commentsNextCursor}
        initialLikedKeys={[...likedSet]}
        profilesByUid={Object.fromEntries(profilesByUid)}
        user={user}
      />
    </article>
  );
}
