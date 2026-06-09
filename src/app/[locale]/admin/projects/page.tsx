import Link from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

import { ProjectVisibilityButton } from "@/app/[locale]/admin/projects/_components/ProjectVisibilityButton";
import { ProjectReviewCard } from "@/app/[locale]/admin/projects/_components/ProjectReviewCard";
import { getSessionUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/data/projects";
import { getPublicProfilesByUids } from "@/lib/data/users";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import type { ProjectDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_CLASSES: Record<string, string> = {
  pending:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  approved:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  rejected: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  archived: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
};

export default async function AdminProjectsPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [t, common, statusT] = await Promise.all([
    getTranslations("Admin.projects"),
    getTranslations("Admin.common"),
    getTranslations("Status"),
  ]);

  const [pending, approved, rejected, archived] = await Promise.all([
    listProjects({ status: "pending", limit: 50 }).catch(() => []),
    listProjects({ status: "approved", limit: 50 }).catch(() => []),
    listProjects({ status: "rejected", limit: 20 }).catch(() => []),
    listProjects({ status: "archived", limit: 20 }).catch(() => []),
  ]);
  const ownerProfiles = await getPublicProfilesByUids(
    Array.from(
      new Set([
        ...pending.map((p) => p.ownerUid),
        ...approved.map((p) => p.ownerUid),
        ...rejected.map((p) => p.ownerUid),
        ...archived.map((p) => p.ownerUid),
      ]),
    ),
  );
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
        <ProjectList
          projects={approved}
          empty={t("emptyApproved")}
          labelFor={labelFor}
          statusT={statusT}
          commonT={common}
          archiveAction
        />
      </section>

      {rejected.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold">
            {t("titleRejected", { count: rejected.length })}
          </h2>
          <ProjectList
            projects={rejected}
            empty=""
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
          <ProjectList
            projects={archived}
            empty=""
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

function ProjectList({
  projects,
  empty,
  labelFor,
  statusT,
  commonT,
  archiveAction = false,
  publishAction = false,
}: {
  projects: ProjectDoc[];
  empty: string;
  labelFor: (uid: string, fallback: string) => string;
  statusT: (key: string) => string;
  commonT: (key: string) => string;
  archiveAction?: boolean;
  publishAction?: boolean;
}) {
  if (projects.length === 0) {
    return empty ? <p className="mt-2 text-sm text-zinc-500">{empty}</p> : null;
  }

  return (
    <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
      {projects.map((p) => {
        const cls = STATUS_CLASSES[p.status] ?? STATUS_CLASSES.pending;
        return (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.title}</span>
                <span
                  className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium ${cls}`}
                >
                  {statusT(p.status)}
                </span>
              </div>
              <p className="text-xs text-zinc-500">
                {labelFor(p.ownerUid, p.ownerName)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              {p.status === "approved" && (
                <Link
                  href={`/showcase/${p.slug}`}
                  className="text-blue-600 hover:underline"
                >
                  {commonT("preview")}
                </Link>
              )}
              <Link
                href={`/admin/projects/${p.id}/edit`}
                className="text-blue-600 hover:underline"
              >
                {commonT("edit")}
              </Link>
              {archiveAction && (
                <ProjectVisibilityButton projectId={p.id} visible={false} />
              )}
              {publishAction && (
                <ProjectVisibilityButton projectId={p.id} visible />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
