import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { GuideForm } from "@/app/[locale]/admin/guides/_components/GuideForm";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("NewGuide");
  return { title: t("metadataTitle") };
}

// Public-facing entry point for community guide submissions.
//
// Anyone signed in can land here. The form (and the server action) take
// care of selecting the right intent buttons + final status for the
// caller's role: plain users submit to the admin review queue, while
// admin / editor / contributor can publish directly and
// skip the queue. The same `GuideForm` powers the admin route, so this
// page is just the public wrapper + a contextual blurb.
export default async function NewCommunityGuidePage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("NewGuide"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath("/guide/new", locale));

  const canPublishDirectly =
    user.isAdmin || user.isEditor || user.isContributor;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        {canPublishDirectly ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("directDescription")}
          </p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("reviewDescription")}
          </p>
        )}
      </header>
      <GuideForm mode="create" user={user} />
    </div>
  );
}
