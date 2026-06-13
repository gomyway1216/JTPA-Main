"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { cancelRsvp } from "@/app/actions/rsvps";
import { useRouter } from "@/i18n/navigation";

export function CancelRsvpButton({ eventId }: { eventId: string }) {
  const t = useTranslations("MyRsvps");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCancel() {
    setError(null);
    if (!confirm(t("cancelConfirm"))) return;

    startTransition(async () => {
      try {
        const result = await cancelRsvp({ eventId });
        if (result.ok) {
          router.refresh();
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("cancelError"));
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <button
        type="button"
        onClick={handleCancel}
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {pending ? t("cancelling") : t("cancel")}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
