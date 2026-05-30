import { redirect } from "next/navigation";

import { GuideForm } from "@/app/[locale]/admin/guides/_components/GuideForm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "ガイドを投稿" };

// Public-facing entry point for community guide submissions.
//
// Anyone signed in can land here. The form (and the server action) take
// care of selecting the right intent buttons + final status for the
// caller's role: plain users see "審査に出す" and submit to the admin
// review queue, while admin / editor / contributor see "公開する" and
// skip the queue. The same `GuideForm` powers the admin route, so this
// page is just the public wrapper + a contextual blurb.
export default async function NewCommunityGuidePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/guide/new");

  const canPublishDirectly =
    user.isAdmin || user.isEditor || user.isContributor;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">ガイドを投稿</h1>
        {canPublishDirectly ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            あなたは信頼された執筆者として登録されているため、ガイドを直接公開できます。
            「下書き保存」「公開する」のどちらでもどうぞ。
          </p>
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            初回の投稿は管理者の確認後に公開されます。 一度承認されると、
            次回からは <strong>contributor</strong>{" "}
            権限が自動付与され、ガイドを直接公開できるようになります。
          </p>
        )}
      </header>
      <GuideForm mode="create" user={user} />
    </div>
  );
}
