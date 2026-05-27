"use client";

import { useState, useTransition } from "react";

import { cloneEvent } from "@/app/actions/events";

export function CloneEventButton({
  eventId,
  eventTitle,
}: {
  eventId: string;
  eventTitle: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!confirm(`「${eventTitle}」を複製しますか？`)) return;
    setError(null);
    startTransition(async () => {
      try {
        // cloneEvent calls redirect() on success, so this never resolves
        // normally — error handling only catches actual failures.
        await cloneEvent(eventId);
      } catch (err) {
        // Next.js' `redirect()` throws an error whose `.digest` starts
        // with "NEXT_REDIRECT". Let those propagate so the navigation
        // actually happens. (Next.js exposes `isRedirectError` only via
        // an internal path in Next 16; the digest check is the stable
        // contract.)
        const digest = (err as { digest?: unknown })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        setError(err instanceof Error ? err.message : "複製に失敗しました");
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className="text-blue-600 hover:underline disabled:opacity-50"
      >
        {pending ? "複製中..." : "複製"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
