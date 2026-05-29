import { redirect } from "next/navigation";

import { FeedbackList } from "@/app/admin/feedback/_components/FeedbackList";
import { getSessionUser } from "@/lib/auth/session";
import { listFeedback } from "@/lib/data/feedback";

export const dynamic = "force-dynamic";
export const metadata = { title: "フィードバック" };

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
  if (!user) redirect("/login?redirect=/admin/feedback");
  if (!user.isAdmin && !user.isEditor) redirect("/");

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
        <h1 className="text-2xl font-bold">フィードバック</h1>
        <p className="text-sm text-zinc-500">
          /help から届いた要望・不具合報告の triage 画面です。
          新しいものから順に並びます。
        </p>
      </header>

      <FeedbackList entries={entries} viewerIsAdmin={user.isAdmin} />
    </div>
  );
}
