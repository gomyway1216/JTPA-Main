import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white py-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-center sm:justify-between">
        {/*
          Copyright + quiet maintainer credit. Kept on a single line
          with a thin separator so the personal credit reads as a
          footnote rather than a co-equal byline. The name is one
          shade lighter than the surrounding text on purpose — visible
          to anyone scanning the footer, but doesn't compete with the
          JTPA branding.

          External link → `rel="noreferrer noopener"` so the linked
          page can't access `window.opener`, and `target="_blank"` so
          the reader doesn't lose the JTPA page they were on. The
          /about page also carries a fuller maintainer block; this
          line exists so the credit survives even when admin edits
          the about Markdown.
        */}
        <p>
          © {new Date().getFullYear()} JTPA
          <span aria-hidden="true" className="mx-2 text-zinc-300 dark:text-zinc-700">·</span>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            by{" "}
            <a
              href="https://meetyudai.com"
              target="_blank"
              rel="noreferrer noopener"
              className="hover:text-zinc-600 hover:underline dark:hover:text-zinc-300"
            >
              Yudai Yaguchi
            </a>
          </span>
        </p>
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
