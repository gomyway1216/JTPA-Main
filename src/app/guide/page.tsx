import Link from "next/link";

import { GuideListClient } from "@/app/guide/_components/GuideListClient";
import { getSessionUser } from "@/lib/auth/session";
import { listGuides } from "@/lib/data/guides";

export const dynamic = "force-dynamic";
export const metadata = { title: "ガイド" };

export default async function GuideIndexPage() {
  // Intentionally not catching — see the admin list rationale: a missing
  // composite index here surfaces a fix-this link in the error, swallowing
  // it would hide the easiest debug signal.
  const [user, guides] = await Promise.all([
    getSessionUser(),
    listGuides({
      statuses: ["published"],
      limit: 200,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">ガイド</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            AI ツールのセットアップから使いこなしまで、コミュニティでまとめた手引き集です。
            あなたのノウハウもぜひ投稿してください。
          </p>
        </div>
        {/* Submit-button location matches /qa and /poll: top-right of the
            list page so signed-in users see an obvious entry point.
            Logged-out visitors get an alternate Sign-in-and-write CTA. */}
        {user ? (
          <Link
            href="/guide/new"
            className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            ガイドを投稿
          </Link>
        ) : (
          <Link
            href="/login?redirect=/guide/new"
            className="shrink-0 rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ログインして投稿
          </Link>
        )}
      </header>
      <GuideListClient guides={guides} />
    </div>
  );
}
