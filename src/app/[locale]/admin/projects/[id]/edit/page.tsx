import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ProjectForm } from "@/app/[locale]/projects/_components/ProjectForm";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectById } from "@/lib/data/projects";
import {
  redirectToLocalizedPath,
  redirectToLoginPath,
} from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function AdminEditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return redirectToLoginPath(`/admin/projects/${id}/edit`);
  if (!user.isAdmin) return redirectToLocalizedPath("/admin/guides");

  const [t, project] = await Promise.all([
    getTranslations("EditPages"),
    getProjectById(id),
  ]);
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <h1 className="text-2xl font-bold">{t("project")}</h1>
      <ProjectForm mode="edit" user={user} project={project} returnTo="admin" />
    </div>
  );
}
