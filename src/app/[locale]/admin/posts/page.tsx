import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { LoadErrorBanner } from "@/app/[locale]/admin/_components/LoadErrorBanner";
import { PostStatusButton } from "@/app/[locale]/admin/posts/_components/PostStatusButton";
import { PostReviewCard } from "@/app/[locale]/admin/posts/_components/PostReviewCard";
import { getSessionUser } from "@/lib/auth/session";
import { listPostsByStatus } from "@/lib/data/posts";
import { safeLoad } from "@/lib/data/safe-load";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import type { PostDoc } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.posts");
  return { title: t("metadataTitle") };
}

const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  pending:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  published:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  archived: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

export default async function AdminPostsPage() {
  const user = await getSessionUser();
  // Skip the /admin landing — editors hit a second redirect to
  // /admin/guides anyway. Send them straight there for one fewer hop and
  // consistency with the other admin-only routes.
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [locale, t, common, statusT] = await Promise.all([
    getLocale(),
    getTranslations("Admin.posts"),
    getTranslations("Admin.common"),
    getTranslations("Status"),
  ]);

  // Surface the full review queue + the recently-published / rejected /
  // drafted lists. Drafts are visible to admins so they can nudge an
  // author who left something half-finished, but we don't auto-act on them.
  const [pendingRes, publishedRes, rejectedRes, draftsRes, archivedRes] =
    await Promise.all([
      safeLoad("pending posts", () => listPostsByStatus("pending", 50)),
      safeLoad("published posts", () => listPostsByStatus("published", 30)),
      safeLoad("rejected posts", () => listPostsByStatus("rejected", 20)),
      safeLoad("draft posts", () => listPostsByStatus("draft", 20)),
      safeLoad("archived posts", () => listPostsByStatus("archived", 20)),
    ]);
  const pending = pendingRes.ok ? pendingRes.data : [];
  const published = publishedRes.ok ? publishedRes.data : [];
  const rejected = rejectedRes.ok ? rejectedRes.data : [];
  const drafts = draftsRes.ok ? draftsRes.data : [];
  const archived = archivedRes.ok ? archivedRes.data : [];
  const loadFailed = [
    pendingRes,
    publishedRes,
    rejectedRes,
    draftsRes,
    archivedRes,
  ].some((r) => !r.ok);
  // Single batched read covering every author across all four status
  // lists — keeps the admin queue render to one Firestore round-trip
  // for users regardless of post count.
  const authorProfiles = await getPublicProfilesByUids([
    ...pending.map((p) => p.authorUid),
    ...published.map((p) => p.authorUid),
    ...rejected.map((p) => p.authorUid),
    ...drafts.map((p) => p.authorUid),
    ...archived.map((p) => p.authorUid),
  ]);
  const labelFor = (uid: string, fallback: string) => {
    const prof = authorProfiles.get(uid);
    return prof ? `@${prof.username}` : fallback;
  };

  return (
    <div className="space-y-8">
      <LoadErrorBanner show={loadFailed} />
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
        <PostList
          posts={published}
          empty={t("emptyPublished")}
          locale={locale}
          labelFor={labelFor}
          statusT={statusT}
          commonT={common}
          archiveAction
        />
      </section>

      {drafts.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleDrafts", { count: drafts.length })}
          </h2>
          <PostList
            posts={drafts}
            empty=""
            locale={locale}
            labelFor={labelFor}
            statusT={statusT}
            commonT={common}
          />
        </section>
      )}

      {rejected.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleRejected", { count: rejected.length })}
          </h2>
          <PostList
            posts={rejected}
            empty=""
            locale={locale}
            labelFor={labelFor}
            statusT={statusT}
            commonT={common}
          />
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleArchived", { count: archived.length })}
          </h2>
          <PostList
            posts={archived}
            empty=""
            locale={locale}
            labelFor={labelFor}
            statusT={statusT}
            commonT={common}
            publishAction
          />
        </section>
      )}
    </div>
  );
}

function PostList({
  posts,
  empty,
  locale,
  labelFor,
  statusT,
  commonT,
  archiveAction = false,
  publishAction = false,
}: {
  posts: PostDoc[];
  empty: string;
  locale: string;
  labelFor: (uid: string, fallback: string) => string;
  statusT: (key: string) => string;
  commonT: (key: string) => string;
  archiveAction?: boolean;
  publishAction?: boolean;
}) {
  if (posts.length === 0) {
    return empty ? <p className="mt-2 text-sm text-zinc-500">{empty}</p> : null;
  }

  return (
    <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
      {posts.map((p) => {
        const cls = STATUS_CLASSES[p.status] ?? STATUS_CLASSES.draft;
        return (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {p.status === "published" ? (
                  <Link
                    href={`/blog/${p.slug}`}
                    className="font-medium hover:underline"
                  >
                    {p.title}
                  </Link>
                ) : (
                  <span className="font-medium">{p.title}</span>
                )}
                <span
                  className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${cls}`}
                >
                  {statusT(p.status)}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                {labelFor(p.authorUid, p.authorName)}
                {" · "}
                {formatDate(p.updatedAt, locale)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {p.status === "published" && (
                <Link
                  href={`/blog/${p.slug}`}
                  className="text-blue-600 hover:underline"
                >
                  {commonT("preview")}
                </Link>
              )}
              <Link
                href={`/admin/posts/${p.id}/edit`}
                className="text-blue-600 hover:underline"
              >
                {commonT("edit")}
              </Link>
              {archiveAction && <PostStatusButton postId={p.id} status="published" />}
              {publishAction && <PostStatusButton postId={p.id} status="archived" />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
