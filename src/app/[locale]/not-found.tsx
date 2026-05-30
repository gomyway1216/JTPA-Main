import type { Metadata } from "next";
import Link from "@/i18n/navigation";

// Catch-all 404 page. Replaces Next's stock black/white default so a
// missing route still feels like the rest of the site — same header,
// same footer (rendered by the root layout), same typographic system as
// the homepage hero. Server Component on purpose: there's nothing
// interactive here, and keeping it server-rendered means a wrong URL
// never ships JS for a non-page.
//
// Visual choices:
//
//  - Headline copies the homepage hero scale (text-5xl/6xl,
//    `font-semibold`, `tracking-tight`) so the 404 reads as part of the
//    same surface, not a system page bolted on.
//  - Primary CTA is the same rounded-full translucent pill used as the
//    homepage's secondary hero CTA — appropriate here because "go home"
//    is a quiet recovery action, not a marketing push. Using the
//    gradient primary would over-promise.
//  - Secondary link points at `/help#feedback` so a user who lands on
//    a 404 from a broken external link has a one-click way to report
//    it.

export const metadata: Metadata = {
  title: "ページが見つかりません — JTPA",
};

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-2xl flex-col items-center justify-center gap-6 px-4 py-20 text-center sm:py-28">
      {/* Eyebrow status code — kept small and quiet so the friendly
          Japanese headline does the actual talking. */}
      <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-700 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300">
        404 Not Found
      </span>

      <h1 className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
        ページが見つかりません
      </h1>

      <p className="max-w-md text-base text-zinc-600 sm:text-lg dark:text-zinc-300">
        お探しのページは削除されたか、URL が間違っているかもしれません。
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
        <Link
          href="/"
          className="rounded-full border border-zinc-300/70 bg-white/70 px-5 py-2 text-sm font-medium backdrop-blur transition hover:bg-white hover:shadow-sm dark:border-zinc-700/70 dark:bg-zinc-950/70 dark:hover:bg-zinc-900"
        >
          ホームに戻る
        </Link>
        <Link
          href="/help#feedback"
          className="text-sm font-medium text-accent hover:underline"
        >
          見つからないページの報告はこちら →
        </Link>
      </div>
    </div>
  );
}
