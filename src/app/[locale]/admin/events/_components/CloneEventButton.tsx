"use client";

import { useTranslations } from "next-intl";
import { unstable_rethrow } from "next/navigation";
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
  const t = useTranslations("Admin.cloneEvent");

  function handleClick() {
    if (!confirm(t("confirm", { title: eventTitle }))) return;
    setError(null);
    startTransition(async () => {
      try {
        // cloneEvent redirects on success (so the call doesn't resolve
        // normally); a not-found returns { ok: false } with a real message
        // instead of throwing it (which prod would mask).
        const res = await cloneEvent(eventId);
        if (res && !res.ok) setError(res.error);
      } catch (err) {
        // cloneEvent redirects on success — let Next's internal
        // control-flow error (NEXT_REDIRECT) propagate so the navigation
        // happens. `unstable_rethrow` is the same helper EventForm /
        // ProfileForm use for this; prefer it over a hand-rolled digest
        // check for consistency. Per PR #116 Copilot review.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("failed"));
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
        {pending ? t("cloning") : t("clone")}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
