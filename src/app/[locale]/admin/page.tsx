import Link from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { LoadErrorBanner } from "@/app/[locale]/admin/_components/LoadErrorBanner";
import { getSessionUser } from "@/lib/auth/session";
import { listEvents } from "@/lib/data/events";
import { countNewFeedback } from "@/lib/data/feedback";
import { listPostsByStatus } from "@/lib/data/posts";
import { listProjects } from "@/lib/data/projects";
import { safeLoad } from "@/lib/data/safe-load";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [t, common] = await Promise.all([
    getTranslations("Admin.dashboard"),
    getTranslations("Admin.common"),
  ]);

  const [pendingRes, upcomingRes, pendingPostsRes, newFeedbackRes] =
    await Promise.all([
      safeLoad("pending projects", () =>
        listProjects({ status: "pending", limit: 5 }),
      ),
      safeLoad("upcoming events", () =>
        listEvents({ statuses: ["draft", "published"], limit: 5 }),
      ),
      safeLoad("pending posts", () => listPostsByStatus("pending", 5)),
      safeLoad("new feedback count", () => countNewFeedback()),
    ]);
  const pending = pendingRes.ok ? pendingRes.data : [];
  const upcoming = upcomingRes.ok ? upcomingRes.data : [];
  const pendingPosts = pendingPostsRes.ok ? pendingPostsRes.data : [];
  const newFeedbackCount = newFeedbackRes.ok ? newFeedbackRes.data : 0;
  const loadFailed = [
    pendingRes,
    upcomingRes,
    pendingPostsRes,
    newFeedbackRes,
  ].some((r) => !r.ok);
  const profiles = await getPublicProfilesByUids([
    ...pending.map((p) => p.ownerUid),
    ...pendingPosts.map((p) => p.authorUid),
  ]);
  const labelFor = (uid: string, fallback: string) => {
    const prof = profiles.get(uid);
    return prof ? `@${prof.username}` : fallback;
  };

  return (
    <div className="space-y-8">
      <LoadErrorBanner show={loadFailed} />
      <h1 className="text-2xl font-bold">{t("title")}</h1>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t("pendingProjects", { count: pending.length })}
          </h2>
          <Link href="/admin/projects" className="text-sm text-blue-600 hover:underline">
            {common("viewAll")}
          </Link>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-500 mt-2">{t("pendingEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {pending.map((p) => (
              <li key={p.id} className="py-2">
                <Link
                  href={`/admin/projects`}
                  className="flex items-center justify-between gap-3 text-sm hover:underline"
                >
                  <span>{p.title}</span>
                  <span className="text-xs text-zinc-500">
                    {labelFor(p.ownerUid, p.ownerName)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t("pendingPosts", { count: pendingPosts.length })}
          </h2>
          <Link href="/admin/posts" className="text-sm text-blue-600 hover:underline">
            {common("viewAll")}
          </Link>
        </div>
        {pendingPosts.length === 0 ? (
          <p className="text-sm text-zinc-500 mt-2">{t("reviewEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {pendingPosts.map((p) => (
              <li key={p.id} className="py-2">
                <Link
                  href="/admin/posts"
                  className="flex items-center justify-between gap-3 text-sm hover:underline"
                >
                  <span>{p.title}</span>
                  <span className="text-xs text-zinc-500">
                    {labelFor(p.authorUid, p.authorName)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t("newFeedback", { count: newFeedbackCount })}
          </h2>
          <Link
            href="/admin/feedback"
            className="text-sm text-blue-600 hover:underline"
          >
            {common("triage")}
          </Link>
        </div>
        <p className="text-sm text-zinc-500 mt-2">
          {newFeedbackCount === 0
            ? t("feedbackEmpty")
            : t("feedbackDescription")}
        </p>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {t("events", { count: upcoming.length })}
          </h2>
          <Link href="/admin/events" className="text-sm text-blue-600 hover:underline">
            {common("manage")}
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-sm text-zinc-500 mt-2">{t("eventsEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {upcoming.map((e) => (
              <li key={e.id} className="py-2">
                <Link
                  href={`/admin/events/${e.id}/edit`}
                  className="flex items-center justify-between gap-3 text-sm hover:underline"
                >
                  <span>{e.title}</span>
                  <span className="text-xs text-zinc-500">{e.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
