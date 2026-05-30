import { getTranslations } from "next-intl/server";

import { ProjectReviewCard } from "@/app/[locale]/admin/projects/_components/ProjectReviewCard";
import { getSessionUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/data/projects";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function AdminProjectsPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const t = await getTranslations("Admin.projects");

  const [pending, approved, rejected] = await Promise.all([
    listProjects({ status: "pending", limit: 50 }).catch(() => []),
    listProjects({ status: "approved", limit: 50 }).catch(() => []),
    listProjects({ status: "rejected", limit: 20 }).catch(() => []),
  ]);
  const ownerProfiles = await getPublicProfilesByUids([
    ...pending.map((p) => p.ownerUid),
    ...approved.map((p) => p.ownerUid),
    ...rejected.map((p) => p.ownerUid),
  ]);
  const labelFor = (uid: string, fallback: string) => {
    const prof = ownerProfiles.get(uid);
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
              <ProjectReviewCard
                key={p.id}
                project={p}
                ownerProfile={ownerProfiles.get(p.ownerUid) ?? null}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">
          {t("titleApproved", { count: approved.length })}
        </h2>
        <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
          {approved.map((p) => (
            <li key={p.id} className="py-2 text-sm flex justify-between gap-3">
              <span>{p.title}</span>
              <span className="text-zinc-500">
                {labelFor(p.ownerUid, p.ownerName)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {rejected.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleRejected", { count: rejected.length })}
          </h2>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {rejected.map((p) => (
              <li key={p.id} className="py-2 text-sm flex justify-between gap-3">
                <span>{p.title}</span>
                <span className="text-zinc-500">
                {labelFor(p.ownerUid, p.ownerName)}
              </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
