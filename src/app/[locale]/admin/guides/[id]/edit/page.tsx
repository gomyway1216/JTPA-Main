import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { GuideForm } from "@/app/[locale]/admin/guides/_components/GuideForm";
import { getSessionUser } from "@/lib/auth/session";
import { getGuideById } from "@/lib/data/guides";
import {
  redirectToLocalizedPath,
  redirectToLoginPath,
} from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function EditGuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return redirectToLoginPath(`/admin/guides/${id}/edit`);
  if (!user.isAdmin && !user.isEditor) return redirectToLocalizedPath("/admin/guides");

  const guide = await getGuideById(id);
  if (!guide) notFound();
  const t = await getTranslations("Admin.guides");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("editTitle")}</h1>
      <GuideForm mode="edit" user={user} guide={guide} showCurationFields />
    </div>
  );
}
