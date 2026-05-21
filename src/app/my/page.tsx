import Link from "next/link";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?redirect=/my");

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">マイページ</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {user.displayName} ({user.email})
        </p>
      </header>

      <nav className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/my/rsvps"
          className="rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-lg font-semibold">参加履歴</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            参加予定・過去のイベント
          </p>
        </Link>
        <Link
          href="/my/projects"
          className="rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-lg font-semibold">自分の投稿</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            ショーケースに投稿したプロジェクト
          </p>
        </Link>
      </nav>
    </div>
  );
}
