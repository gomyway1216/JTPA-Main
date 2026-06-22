import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { ProjectForm } from "@/app/[locale]/projects/_components/ProjectForm";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("NewProject");
  return { title: t("metadataTitle") };
}

export default async function NewProjectPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("NewProject"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath("/projects/new", locale));

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("description")}
        </p>
      </header>
      <ProjectForm mode="create" user={user} />
    </div>
  );
}
