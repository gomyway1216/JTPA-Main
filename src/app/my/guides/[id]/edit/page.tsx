import { notFound, redirect } from "next/navigation";

import { GuideForm } from "@/app/admin/guides/_components/GuideForm";
import { getSessionUser } from "@/lib/auth/session";
import { getGuideById } from "@/lib/data/guides";

export const dynamic = "force-dynamic";
export const metadata = { title: "ガイドを編集" };

// Author-facing edit route. Mirrors /my/posts/[id]/edit.
//
// Visibility is owner-only: 404 (not 403) for someone else's guide so we
// don't leak whether the id exists. Admin / editor land here too — they
// can edit their own guides like anyone else — but the dedicated
// /admin/guides/[id]/edit route is the canonical entry for moderation.
export default async function MyGuideEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect(`/login?redirect=/my/guides/${id}/edit`);

  const guide = await getGuideById(id);
  if (!guide) notFound();

  // Same fallback as `updateGuide` Server Action — legacy guides have
  // `createdBy.uid` but no `authorUid`. Either match counts as ownership.
  const ownerUid = guide.authorUid ?? guide.createdBy?.uid;
  if (ownerUid !== user.uid && !user.isAdmin && !user.isEditor) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-4">
      <h1 className="text-2xl font-bold">ガイドを編集</h1>
      <GuideForm mode="edit" user={user} guide={guide} />
    </div>
  );
}
