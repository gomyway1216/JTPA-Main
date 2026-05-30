import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { PostReviewCard } from "@/app/[locale]/admin/posts/_components/PostReviewCard";
import { getSessionUser } from "@/lib/auth/session";
import { listPostsByStatus } from "@/lib/data/posts";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.posts");
  return { title: t("metadataTitle") };
}

export default async function AdminPostsPage() {
  const user = await getSessionUser();
  // Skip the /admin landing — editors hit a second redirect to
  // /admin/guides anyway. Send them straight there for one fewer hop and
  // consistency with the other admin-only routes.
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("Admin.posts"),
  ]);

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
  // Single batched read covering every author across all four status
  // lists — keeps the admin queue render to one Firestore round-trip
  // for users regardless of post count.
  const authorProfiles = await getPublicProfilesByUids([
    ...pending.map((p) => p.authorUid),
    ...published.map((p) => p.authorUid),
    ...rejected.map((p) => p.authorUid),
    ...drafts.map((p) => p.authorUid),
  ]);
  const labelFor = (uid: string, fallback: string) => {
    const prof = authorProfiles.get(uid);
    return prof ? `@${prof.username}` : fallback;
  };

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">
          {t("titlePending", { count: pending.length })}
        </h1>
        <div className="mt-4 space-y-3">
          {pending.length === 0 ? (
            <p className="text-sm text-zinc-500">{t("emptyPending")}</p>
          ) : (
            pending.map((p) => (
              <PostReviewCard
                key={p.id}
                post={p}
                authorProfile={authorProfiles.get(p.authorUid) ?? null}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">
          {t("titlePublished", { count: published.length })}
        </h2>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {published.length === 0 ? (
            <li className="py-2 text-sm text-zinc-500">{t("emptyPublished")}</li>
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
                  {labelFor(p.authorUid, p.authorName)}
                  {p.publishedAt && <> · {formatDate(p.publishedAt, locale)}</>}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      {drafts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleDrafts", { count: drafts.length })}
          </h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {drafts.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <span>{p.title}</span>
                <span className="text-xs text-zinc-500">
                  {labelFor(p.authorUid, p.authorName)} ·{" "}
                  {t("updated", { date: formatDate(p.updatedAt, locale) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rejected.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleRejected", { count: rejected.length })}
          </h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {rejected.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              >
                <span>{p.title}</span>
                <span className="text-xs text-zinc-500">
                  {labelFor(p.authorUid, p.authorName)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
