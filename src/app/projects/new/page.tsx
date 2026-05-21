import { redirect } from "next/navigation";

import { ProjectForm } from "@/app/projects/_components/ProjectForm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "プロジェクトを投稿" };

export default async function NewProjectPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/projects/new");

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">プロジェクトを投稿</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          投稿された内容は管理者の承認後にショーケースに掲載されます。
        </p>
      </header>
      <ProjectForm mode="create" />
    </div>
  );
}
