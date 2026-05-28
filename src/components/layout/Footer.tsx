import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} JTPA</p>
        <nav className="flex flex-wrap gap-4 text-xs">
          <Link href="/about" className="hover:underline">
            JTPAとは
          </Link>
          <Link href="/help" className="hover:underline">
            ヘルプ・使い方
          </Link>
          <Link href="/guide" className="hover:underline">
            ガイド
          </Link>
          <Link href="/qa" className="hover:underline">
            Q&amp;A
          </Link>
        </nav>
      </div>
    </footer>
  );
}
