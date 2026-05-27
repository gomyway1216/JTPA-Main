import { notFound } from "next/navigation";

import { GuideForm } from "@/app/admin/guides/_components/GuideForm";
import { getGuideById } from "@/lib/data/guides";

export const dynamic = "force-dynamic";

export default async function EditGuidePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const guide = await getGuideById(id);
  if (!guide) notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ガイド編集</h1>
      <GuideForm mode="edit" guide={guide} />
    </div>
  );
}
