import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p>© {new Date().getFullYear()} JTPA</p>
          {/*
            Maintainer credit. External link → `rel="noreferrer noopener"`
            so the third-party page can't access `window.opener`, and
            `target="_blank"` so it doesn't pull the JTPA reader away
            from the page they were on. Kept here (not in the about
            page only) so it stays visible even when /about content
            gets edited via /admin/about.
          */}
          <p className="text-xs text-zinc-500">
            Built by{" "}
            <a
              href="https://meetyudai.com"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:underline"
            >
              Yudai Yaguchi
            </a>
          </p>
        </div>
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
