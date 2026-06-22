import { getLocale, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";

import { QaForm } from "@/app/[locale]/qa/_components/QaForm";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getQaBySlug } from "@/lib/data/qa";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("EditPages");
  return { title: t("qa") };
}

export default async function EditQaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) {
    const locale = await getLocale();
    redirect(loginPath(`/qa/${slug}/edit`, locale));
  }

  const t = await getTranslations("EditPages");

  const qa = await getQaBySlug(slug);
  if (!qa) notFound();
  if (qa.authorUid !== user.uid && !user.isAdmin) {
    // Non-owners get a 404 rather than a 403 so we don't leak whether
    // the slug exists.
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">{t("qa")}</h1>
      </header>
      <QaForm mode="edit" user={user} qa={qa} />
    </div>
  );
}
