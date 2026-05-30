import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { listMyPosts } from "@/lib/data/posts";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("MyPosts");
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

export default async function MyPostsPage() {
  const [locale, t, common, statusT] = await Promise.all([
    getLocale(),
    getTranslations("MyPosts"),
    getTranslations("MyCommon"),
    getTranslations("Status"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath("/my/posts", locale));

  // Surface unexpected errors to server logs. Missing composite indexes
  // (the most common cause of failure here) show up as Firestore errors
  // that include a one-click "create index" link in the message, but only
  // if we actually log them.
  const posts = await listMyPosts(user.uid).catch((err) => {
    console.error("Failed to list my posts:", err);
    return [];
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link
          href="/blog/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {common("newPost")}
        </Link>
      </div>

      {posts.length === 0 ? (
        <p className="text-zinc-500">{common("emptyPosts")}</p>
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => {
            const cls = STATUS_CLASSES[p.status] ?? STATUS_CLASSES.draft;
            return (
              <li
                key={p.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">{p.title}</h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      {common("lastUpdated", {
                        date: formatDate(p.updatedAt, locale),
                      })}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
                      {p.excerpt}
                    </p>
                    {p.status === "rejected" && p.reviewNote && (
                      <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                        {common("reviewComment", { comment: p.reviewNote })}
                      </p>
                    )}
                  </div>
                  <span
                    className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${cls}`}
                  >
                    {statusT(p.status)}
                  </span>
                </div>
                <div className="mt-3 flex gap-3 text-sm">
                  <Link
                    href={`/my/posts/${p.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    {common("edit")}
                  </Link>
                  {p.status === "published" && (
                    <Link
                      href={`/blog/${p.slug}`}
                      className="text-blue-600 hover:underline"
                    >
                      {common("viewPublic")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
