import Link from "@/i18n/navigation";

import { GuideReviewCard } from "@/app/[locale]/admin/guides/_components/GuideReviewCard";
import { listGuides, listGuidesByStatus } from "@/lib/data/guides";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Restructured around the moderation workflow now that guides support
// community submissions. Layout mirrors /admin/posts: pending queue on
// top with approve/reject cards, then collapsed sections for published /
// drafts / rejected. Failures on any individual section log + degrade
// to an empty list so a missing composite index on (say) rejected guides
// doesn't blank out the pending queue too — the same shape as
// /admin/posts.
export default async function AdminGuidesPage() {
  // listGuides handles the curated published+draft view (ordered by the
  // `order` field); listGuidesByStatus drives the per-state sections
  // (pending / rejected) where chronological updatedAt is the
  // appropriate sort.
  const [pending, published, drafts, rejected] = await Promise.all([
    listGuidesByStatus("pending", 50).catch((err) => {
      console.error("Failed to list pending guides:", err);
      return [];
    }),
    listGuides({ statuses: ["published"], limit: 200 }).catch((err) => {
      console.error("Failed to list published guides:", err);
      return [];
    }),
    listGuides({ statuses: ["draft"], limit: 100 }).catch((err) => {
      console.error("Failed to list draft guides:", err);
      return [];
    }),
    listGuidesByStatus("rejected", 20).catch((err) => {
      console.error("Failed to list rejected guides:", err);
      return [];
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ガイド管理</h1>
        <Link
          href="/admin/guides/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          新規作成
        </Link>
      </div>

      <section>
        <h2 className="text-xl font-semibold">
          審査待ち ({pending.length})
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          コミュニティ投稿の審査キュー。承認すると初回投稿者には
          <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">
            contributor
          </code>
          権限が自動付与されます (二度目以降は自走可)。
        </p>
        <div className="mt-3 space-y-3">
          {pending.length === 0 ? (
            <p className="text-sm text-zinc-500">審査待ちはありません。</p>
          ) : (
            pending.map((g) => <GuideReviewCard key={g.id} guide={g} />)
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">公開中 ({published.length})</h2>
        {published.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">
            公開中のガイドはありません。
          </p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-2">タイトル</th>
                <th className="py-2">投稿者</th>
                <th className="py-2">タグ</th>
                <th className="py-2">順</th>
                <th className="py-2">更新</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {published.map((g) => (
                <tr key={g.id}>
                  <td className="py-2 font-medium">{g.title}</td>
                  <td className="py-2 text-zinc-500">
                    {g.authorName ?? g.createdBy?.displayName ?? "—"}
                  </td>
                  <td className="py-2 text-zinc-500">
                    {g.tags.length === 0 ? "—" : g.tags.join(", ")}
                  </td>
                  <td className="py-2 text-zinc-500">{g.order}</td>
                  <td className="py-2 text-zinc-500">
                    {formatDateTime(g.updatedAt)}
                  </td>
                  <td className="py-2 text-right">
                    <Link
                      href={`/admin/guides/${g.id}/edit`}
                      className="text-blue-600 hover:underline"
                    >
                      編集
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {drafts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">下書き ({drafts.length})</h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {drafts.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/admin/guides/${g.id}/edit`}
                  className="font-medium hover:underline"
                >
                  {g.title}
                </Link>
                <span className="text-xs text-zinc-500">
                  {g.authorName ?? g.createdBy?.displayName ?? "—"} · 最終更新{" "}
                  {formatDateTime(g.updatedAt)}
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
            {rejected.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <Link
                  href={`/admin/guides/${g.id}/edit`}
                  className="hover:underline"
                >
                  {g.title}
                </Link>
                <span className="text-xs text-zinc-500">
                  {g.authorName ?? g.createdBy?.displayName ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
