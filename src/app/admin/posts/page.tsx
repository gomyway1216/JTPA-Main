import Link from "next/link";
import { redirect } from "next/navigation";

import { PostReviewCard } from "@/app/admin/posts/_components/PostReviewCard";
import { getSessionUser } from "@/lib/auth/session";
import { listPostsByStatus } from "@/lib/data/posts";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "ブログ管理" };

export default async function AdminPostsPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) redirect("/admin");

  // Surface the full review queue + the recently-published / rejected /
  // drafted lists. Drafts are visible to admins so they can nudge an
  // author who left something half-finished, but we don't auto-act on them.
  const [pending, published, rejected, drafts] = await Promise.all([
    listPostsByStatus("pending", 50).catch((err) => {
      console.error("Failed to list pending posts:", err);
      return [];
    }),
    listPostsByStatus("published", 30).catch((err) => {
      console.error("Failed to list published posts:", err);
      return [];
    }),
    listPostsByStatus("rejected", 20).catch((err) => {
      console.error("Failed to list rejected posts:", err);
      return [];
    }),
    listPostsByStatus("draft", 20).catch((err) => {
      console.error("Failed to list draft posts:", err);
      return [];
    }),
  ]);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">
          審査待ち ({pending.length})
        </h1>
        <div className="mt-4 space-y-3">
          {pending.length === 0 ? (
            <p className="text-sm text-zinc-500">審査待ちはありません。</p>
          ) : (
            pending.map((p) => <PostReviewCard key={p.id} post={p} />)
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">公開中 ({published.length})</h2>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {published.length === 0 ? (
            <li className="py-2 text-sm text-zinc-500">公開中の記事はありません。</li>
          ) : (
            published.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/blog/${p.slug}`}
                  className="font-medium hover:underline"
                >
                  {p.title}
                </Link>
                <span className="text-xs text-zinc-500">
                  {p.authorName}
                  {p.publishedAt && <> · {formatDate(p.publishedAt)}</>}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      {drafts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">下書き ({drafts.length})</h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {drafts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <span>{p.title}</span>
                <span className="text-xs text-zinc-500">
                  {p.authorName} · 最終更新 {formatDate(p.updatedAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rejected.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">却下 ({rejected.length})</h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {rejected.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <span>{p.title}</span>
                <span className="text-xs text-zinc-500">{p.authorName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
