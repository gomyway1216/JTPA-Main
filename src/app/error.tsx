"use client";

import Link from "next/link";
import { useEffect } from "react";

import { primaryButtonClass } from "@/components/forms/styles";

// Per-route error boundary. Catches any render-time error thrown by a
// page below `app/` and replaces the page content with this friendly
// fallback. Next.js REQUIRES this file to be a Client Component (the
// error boundary uses class-component machinery under the hood and
// needs to ship to the client to run), and it MUST accept
// `{ error, reset }` as props — the `reset` callback re-mounts the
// failing route segment so a user can retry without a hard reload.
//
// Mirrors `not-found.tsx`'s layout intentionally — same vertical
// rhythm, same headline scale, same pill-style secondary link — so the
// two recovery surfaces feel like a pair rather than two ad-hoc pages.
// The primary CTA here uses the gradient `primaryButtonClass` (instead
// of the translucent pill the 404 uses) to put visual weight on
// "retry" — the more useful action when something genuinely broke.
//
// Inert by design: no fetches, no Server Action calls, no analytics.
// Anything that could itself throw would put us in a re-render loop
// (the boundary catches an error → renders this → this throws → repeat).
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Log to the browser console on mount so dev mode still surfaces the
  // stack trace even though the boundary swallows the throw for the
  // user-facing UI. In production this is harmless — the digest is the
  // only thing we expose to the user, and the stack is already stripped
  // by Next's prod error masking.
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-12rem)] max-w-2xl flex-col items-center justify-center gap-6 px-4 py-20 text-center sm:py-28">
      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50/80 px-3 py-1 text-xs font-medium text-red-700 backdrop-blur dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
        Something went wrong
      </span>

      <h1 className="text-5xl font-semibold leading-tight tracking-tight sm:text-6xl">
        エラーが発生しました
      </h1>

      <p className="max-w-md text-base text-zinc-600 sm:text-lg dark:text-zinc-300">
        問題が発生したため処理を中断しました。もう一度お試しください。
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
        {/* Retry sits on the gradient primary so it reads as the
            recommended action. `type="button"` to be explicit — this
            isn't inside a form, but a stray default `type="submit"`
            inside one would be a footgun. */}
        <button type="button" onClick={reset} className={primaryButtonClass}>
          再試行
        </button>
        <Link
          href="/"
          className="rounded-full border border-zinc-300/70 bg-white/70 px-5 py-2 text-sm font-medium backdrop-blur transition hover:bg-white hover:shadow-sm dark:border-zinc-700/70 dark:bg-zinc-950/70 dark:hover:bg-zinc-900"
        >
          ホームに戻る
        </Link>
      </div>

      {/*
        Production-safe error ID. Next attaches `digest` to errors that
        bubble out of a Server Component so the actual message can stay
        server-side; surfacing the digest here lets a user paste it into
        a support report without exposing the underlying stack. Hidden
        in dev (no digest) so the empty `error-id:` placeholder doesn't
        clutter the page during local development.
      */}
      {error.digest && (
        <p className="pt-2 font-mono text-xs text-zinc-500 dark:text-zinc-500">
          error-id: {error.digest}
        </p>
      )}
    </div>
  );
}
