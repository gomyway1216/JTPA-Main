import { getLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { ProjectForm } from "@/app/[locale]/projects/_components/ProjectForm";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getProjectById } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export default async function EditMyProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    const locale = await getLocale();
    redirect(loginPath(`/my/projects/${id}/edit`, locale));
  }

  const t = await getTranslations("EditPages");

  const project = await getProjectById(id);
  if (!project || project.ownerUid !== user.uid) notFound();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-4">
      <h1 className="text-2xl font-bold">{t("project")}</h1>
      <ProjectForm mode="edit" user={user} project={project} />
    </div>
  );
}
