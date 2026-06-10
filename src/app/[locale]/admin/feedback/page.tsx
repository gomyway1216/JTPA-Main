import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Link from "@/i18n/navigation";
import { LoadErrorBanner } from "@/app/[locale]/admin/_components/LoadErrorBanner";
import { FeedbackList } from "@/app/[locale]/admin/feedback/_components/FeedbackList";
import { getSessionUser } from "@/lib/auth/session";
import { listFeedback } from "@/lib/data/feedback";
import { safeLoad } from "@/lib/data/safe-load";
import {
  redirectToLocalizedPath,
  redirectToLoginPath,
} from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.feedback");
  return { title: t("metadataTitle") };
}

// Admin + editor triage page for /help submissions. Editors get this
// view (and the matching write Server Action gate is `requireEditor`)
// because triage is a shared workload — admins shouldn't be the
// bottleneck for marking entries read / resolved. Plain users bounce.
//
// The page is built around three buckets (new / read / resolved) and a
// fourth `archived` view for entries we want to keep but hide from the
// default triage. We fetch one cursor-sized page (newest first) and let
// the client component bucket + filter it in memory — fast enough at
// the expected volume (single-digit entries per day) and avoids the
// either/or of a separate query per tab. Older entries are reached via
// the `?cursor=` next-page link below the list, which keeps the
// Firestore read bounded no matter how big the backlog grows; the
// status tabs (and their counts) apply to the page being viewed.
export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return redirectToLoginPath("/admin/feedback");
  if (!user.isAdmin && !user.isEditor) return redirectToLocalizedPath("/");
  const t = await getTranslations("Admin.feedback");
  const { cursor } = await searchParams;

  // Always include archived in the read so the "all" filter in the
  // client component has the docs available without a re-fetch when
  // the user flips the filter. Triggered list-side filtering keeps the
  // network behavior single-shot.
  const entriesRes = await safeLoad("feedback", () =>
    listFeedback({
      statuses: ["new", "read", "resolved", "archived"],
      cursor: cursor ?? null,
    }),
  );
  // On a failed read, degrade to an empty page with no next cursor; the
  // banner below surfaces the failure (so empty-because-error stays
  // distinguishable from empty-because-no-data).
  const { entries, nextCursor } = entriesRes.ok
    ? entriesRes.data
    : { entries: [], nextCursor: null };

  return (
    <div className="space-y-6">
      <LoadErrorBanner show={!entriesRes.ok} />
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-zinc-500">
          {t("description")}
        </p>
      </header>

      <FeedbackList entries={entries} viewerIsAdmin={user.isAdmin} />

      {(cursor || nextCursor) && (
        <nav className="flex items-center gap-4 text-sm">
          {cursor && (
            <Link
              href="/admin/feedback"
              className="text-zinc-600 hover:underline dark:text-zinc-400"
            >
              {t("backToLatest")}
            </Link>
          )}
          {nextCursor && (
            <Link
              // The cursor is base64url (already URL-safe); encode anyway
              // so the link stays valid even if the format ever changes.
              href={`/admin/feedback?cursor=${encodeURIComponent(nextCursor)}`}
              className="text-zinc-600 hover:underline dark:text-zinc-400"
            >
              {t("nextPage")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
