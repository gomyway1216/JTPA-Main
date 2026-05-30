import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { FeedbackList } from "@/app/[locale]/admin/feedback/_components/FeedbackList";
import { getSessionUser } from "@/lib/auth/session";
import { listFeedback } from "@/lib/data/feedback";
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
// default triage. We fetch them all in a single query and let the
// client component bucket + filter in memory — fast enough at the
// expected volume (single-digit entries per day) and avoids the
// either/or of a separate query per tab.
export default async function AdminFeedbackPage() {
  const user = await getSessionUser();
  if (!user) return redirectToLoginPath("/admin/feedback");
  if (!user.isAdmin && !user.isEditor) return redirectToLocalizedPath("/");
  const t = await getTranslations("Admin.feedback");

  // Always include archived in the read so the "all" filter in the
  // client component has the docs available without a re-fetch when
  // the user flips the filter. Triggered list-side filtering keeps the
  // network behavior single-shot.
  const entries = await listFeedback({
    statuses: ["new", "read", "resolved", "archived"],
    limit: 500,
  }).catch((err) => {
    console.error("Failed to list feedback:", err);
    return [];
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-zinc-500">
          {t("description")}
        </p>
      </header>

      <FeedbackList entries={entries} viewerIsAdmin={user.isAdmin} />
    </div>
  );
}
