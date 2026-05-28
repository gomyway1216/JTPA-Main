import Link from "next/link";

import { SignOutButton } from "@/components/auth/SignOutButton";
import type { SessionUser } from "@/lib/types";

export function Header({ user }: { user: SessionUser | null }) {
  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            JTPA
          </Link>
          <nav className="hidden gap-4 text-sm text-zinc-700 sm:flex dark:text-zinc-300">
            <Link href="/events" className="hover:text-zinc-950 dark:hover:text-white">
              イベント
            </Link>
            <Link href="/showcase" className="hover:text-zinc-950 dark:hover:text-white">
              ショーケース
            </Link>
            <Link href="/blog" className="hover:text-zinc-950 dark:hover:text-white">
              ブログ
            </Link>
            <Link href="/guide" className="hover:text-zinc-950 dark:hover:text-white">
              ガイド
            </Link>
            <Link href="/qa" className="hover:text-zinc-950 dark:hover:text-white">
              Q&amp;A
            </Link>
            <Link href="/poll" className="hover:text-zinc-950 dark:hover:text-white">
              投票
            </Link>
            <Link href="/about" className="hover:text-zinc-950 dark:hover:text-white">
              JTPAとは
            </Link>
            <Link href="/help" className="hover:text-zinc-950 dark:hover:text-white">
              ヘルプ
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <>
              {user.isAdmin && (
                <Link
                  href="/admin"
                  className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                >
                  管理
                </Link>
              )}
              <Link href="/my" className="hover:underline">
                {user.displayName || user.email}
              </Link>
              <SignOutButton />
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              ログイン
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
