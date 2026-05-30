import { redirect } from "next/navigation";

import { QaForm } from "@/app/[locale]/qa/_components/QaForm";
import { getSessionUser } from "@/lib/auth/session";

export const metadata = { title: "Q&A を投稿" };

export default async function NewQaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/qa/new");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Q&amp;A を投稿</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          質問・Tips・気づき、なんでも気軽に投稿できます。投稿後すぐに公開されます。
        </p>
      </header>
      <QaForm mode="create" user={user} />
    </div>
  );
}
