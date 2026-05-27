import { GuideForm } from "@/app/admin/guides/_components/GuideForm";

export const dynamic = "force-dynamic";

export default function NewGuidePage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ガイド新規作成</h1>
      <GuideForm mode="create" />
    </div>
  );
}
