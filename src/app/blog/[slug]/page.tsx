import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownBody } from "@/components/markdown/MarkdownBody";
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

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <Link
        href="/blog"
        className="text-xs text-zinc-500 hover:underline"
      >
        ← ブログ一覧
      </Link>

      <header className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">{post.title}</h1>
        <p className="text-sm text-zinc-500">
          by {post.authorName}
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

      {/* Comments live in a separate PR (see follow-up). The container is
          here so the page layout doesn't shift later. */}
      <section
        aria-label="コメント"
        className="border-t border-zinc-200 pt-6 dark:border-zinc-800"
      >
        <p className="text-sm text-zinc-500">
          コメント機能は近日公開予定です。
        </p>
      </section>
    </article>
  );
}
