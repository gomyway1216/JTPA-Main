import { redirect } from "next/navigation";

import { GuideForm } from "@/app/[locale]/admin/guides/_components/GuideForm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function NewGuidePage() {
  const user = await getSessionUser();
  // /admin/* is gated by the layout, but `requireEditor()` in the layout
  // throws on a missing claim; this redirect is a UX nicety for an
  // already-disallowed path. We also need `user` to thread into the
  // form so it knows whether to show "公開する" vs "審査に出す".
  if (!user) redirect("/login?redirect=/admin/guides/new");
  if (!user.isAdmin && !user.isEditor) redirect("/admin/guides");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ガイド新規作成</h1>
      <GuideForm mode="create" user={user} />
    </div>
  );
}
