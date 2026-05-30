import { notFound, redirect } from "next/navigation";

import { GuideForm } from "@/app/[locale]/admin/guides/_components/GuideForm";
import { getSessionUser } from "@/lib/auth/session";
import { getGuideById } from "@/lib/data/guides";

export const dynamic = "force-dynamic";

export default async function EditGuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=/admin/guides/${id}/edit`);
  if (!user.isAdmin && !user.isEditor) redirect("/admin/guides");

  const guide = await getGuideById(id);
  if (!guide) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ガイド編集</h1>
      <GuideForm mode="edit" user={user} guide={guide} />
    </div>
  );
}
