import { redirect } from "next/navigation";

import { PostForm } from "@/app/posts/_components/PostForm";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "記事を投稿" };

export default async function NewPostPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/blog/new");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">記事を投稿</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          投稿された内容は管理者の承認後にブログに掲載されます。下書きとして保存することもできます。
        </p>
      </header>
      <PostForm mode="create" user={user} />
    </div>
  );
}
