import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { LoadErrorBanner } from "@/app/[locale]/admin/_components/LoadErrorBanner";
import { GuideReviewCard } from "@/app/[locale]/admin/guides/_components/GuideReviewCard";
import { listGuides, listGuidesByStatus } from "@/lib/data/guides";
import { safeLoad } from "@/lib/data/safe-load";
import { getLocalizedGuideContent } from "@/lib/localized-content";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Restructured around the moderation workflow now that guides support
// community submissions. Layout mirrors /admin/posts: pending queue on
// top with approve/reject cards, then collapsed sections for published /
// drafts / rejected. Failures on any individual section log + degrade
// to an empty list so a missing composite index on (say) rejected guides
// doesn't blank out the pending queue too — the same shape as
// /admin/posts. A banner flags the partial failure so an empty section
// isn't mistaken for "nothing here".
export default async function AdminGuidesPage() {
  const [locale, t, common] = await Promise.all([
    getLocale(),
    getTranslations("Admin.guides"),
    getTranslations("Admin.common"),
  ]);
  // listGuides handles the curated published+draft view (ordered by the
  // `order` field); listGuidesByStatus drives the per-state sections
  // (pending / rejected) where chronological updatedAt is the
  // appropriate sort.
  const [pendingRes, publishedRes, draftsRes, rejectedRes] = await Promise.all([
    safeLoad("pending guides", () => listGuidesByStatus("pending", 50)),
    safeLoad("published guides", () =>
      listGuides({ statuses: ["published"], limit: 200 }),
    ),
    safeLoad("draft guides", () =>
      listGuides({ statuses: ["draft"], limit: 100 }),
    ),
    safeLoad("rejected guides", () => listGuidesByStatus("rejected", 20)),
  ]);
  const pending = pendingRes.ok ? pendingRes.data : [];
  const published = publishedRes.ok ? publishedRes.data : [];
  const drafts = draftsRes.ok ? draftsRes.data : [];
  const rejected = rejectedRes.ok ? rejectedRes.data : [];
  const loadFailed = [pendingRes, publishedRes, draftsRes, rejectedRes].some(
    (r) => !r.ok,
  );

  return (
    <div className="space-y-8">
      <LoadErrorBanner show={loadFailed} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link
          href="/admin/guides/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {common("createNew")}
        </Link>
      </div>

      <section>
        <h2 className="text-xl font-semibold">
          {t("titlePending", { count: pending.length })}
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {t.rich("pendingDescription", {
            role: (chunks) => (
              <code className="mx-1 rounded bg-zinc-100 px-1 dark:bg-zinc-800">
                {chunks}
              </code>
            ),
          })}
        </p>
        <div className="mt-3 space-y-3">
          {pending.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("emptyPending")}</p>
          ) : (
            pending.map((g) => <GuideReviewCard key={g.id} guide={g} />)
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">
          {t("titlePublished", { count: published.length })}
        </h2>
        {published.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">{t("emptyPublished")}</p>
        ) : (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-2">{t("columns.title")}</th>
                <th className="py-2">{t("columns.author")}</th>
                <th className="py-2">{t("columns.tags")}</th>
                <th className="py-2">{t("columns.order")}</th>
                <th className="py-2">{t("columns.updated")}</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {published.map((g) => {
                const content = getLocalizedGuideContent(g, locale);
                return (
                  <tr key={g.id}>
                    <td className="py-2 font-medium">{content.title}</td>
                    <td className="py-2 text-zinc-500">
                      {g.authorName ?? g.createdBy?.displayName ?? "—"}
                    </td>
                    <td className="py-2 text-zinc-500">
                      {g.tags.length === 0 ? "—" : g.tags.join(", ")}
                    </td>
                    <td className="py-2 text-zinc-500">{g.order}</td>
                    <td className="py-2 text-zinc-500">
                      {formatDateTime(g.updatedAt, locale)}
                    </td>
                    <td className="py-2 text-right">
                      <Link
                        href={`/admin/guides/${g.id}/edit`}
                        className="text-blue-600 hover:underline"
                      >
                        {common("edit")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {drafts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleDrafts", { count: drafts.length })}
          </h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {drafts.map((g) => {
              const content = getLocalizedGuideContent(g, locale);
              return (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <Link
                    href={`/admin/guides/${g.id}/edit`}
                    className="font-medium hover:underline"
                  >
                    {content.title}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {g.authorName ?? g.createdBy?.displayName ?? "—"} ·{" "}
                    {common("updated", {
                      date: formatDateTime(g.updatedAt, locale),
                    })}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {rejected.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleRejected", { count: rejected.length })}
          </h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {rejected.map((g) => {
              const content = getLocalizedGuideContent(g, locale);
              return (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
                >
                  <Link
                    href={`/admin/guides/${g.id}/edit`}
                    className="hover:underline"
                  >
                    {content.title}
                  </Link>
                  <span className="text-xs text-zinc-500">
                    {g.authorName ?? g.createdBy?.displayName ?? "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
