import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { listMyGuides } from "@/lib/data/guides";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("MyGuides");
  return { title: t("metadataTitle") };
}

// Shared with /my/posts so the same status chip class can be reused —
// kept inline here too because the label set is guide-specific (we don't
// surface "archived" prominently for authors).
const STATUS_CLASSES: Record<string, string> = {
  draft: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  pending:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  published:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  archived: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

export default async function MyGuidesPage() {
  const [locale, t, common, statusT] = await Promise.all([
    getLocale(),
    getTranslations("MyGuides"),
    getTranslations("MyCommon"),
    getTranslations("Status"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath("/my/guides", locale));

  // Surface unexpected errors to server logs. Missing composite indexes
  // (the most common cause of failure here) show up as Firestore errors
  // that include a one-click "create index" link in the message — only
  // if we actually log them.
  const guides = await listMyGuides(user.uid).catch((err) => {
    console.error("Failed to list my guides:", err);
    return [];
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <Link
          href="/guide/new"
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {common("newPost")}
        </Link>
      </div>

      {guides.length === 0 ? (
        <p className="text-zinc-500">
          {common("emptyPosts")}
          <Link
            href="/guide/new"
            className="ml-1 text-blue-600 hover:underline"
          >
            {t("writeFirst")}
          </Link>
        </p>
      ) : (
        <ul className="space-y-3">
          {guides.map((g) => {
            const cls = STATUS_CLASSES[g.status] ?? STATUS_CLASSES.draft;
            return (
              <li
                key={g.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-semibold">{g.title}</h2>
                    <p className="mt-1 text-xs text-zinc-500">
                      {common("lastUpdated", {
                        date: formatDate(g.updatedAt, locale),
                      })}
                    </p>
                    {g.tags.length > 0 && (
                      <p className="mt-1 text-xs text-zinc-500">
                        {g.tags.join(" · ")}
                      </p>
                    )}
                    {g.status === "rejected" && g.reviewNote && (
                      <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                        {common("reviewComment", { comment: g.reviewNote })}
                      </p>
                    )}
                  </div>
                  <span
                    className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${cls}`}
                  >
                    {statusT(g.status)}
                  </span>
                </div>
                <div className="mt-3 flex gap-3 text-sm">
                  <Link
                    href={`/my/guides/${g.id}/edit`}
                    className="text-blue-600 hover:underline"
                  >
                    {common("edit")}
                  </Link>
                  {g.status === "published" && (
                    <Link
                      href={`/guide/${g.slug}`}
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
