import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { QaForm } from "@/app/[locale]/qa/_components/QaForm";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";

export async function generateMetadata() {
  const t = await getTranslations("NewQa");
  return { title: t("metadataTitle") };
}

export default async function NewQaPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("NewQa"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath("/qa/new", locale));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t("description")}
        </p>
      </header>
      <QaForm mode="create" user={user} />
    </div>
  );
}
