"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setRsvpStatus } from "@/app/actions/rsvps";
import type { RsvpStatus } from "@/lib/types";

const STATUSES: RsvpStatus[] = ["confirmed", "waitlist", "cancelled"];

export function RsvpStatusSelect({
  eventId,
  rsvpUid,
  initialStatus,
}: {
  eventId: string;
  rsvpUid: string;
  initialStatus: RsvpStatus;
}) {
  const router = useRouter();
  const t = useTranslations("Admin.attendees");
  const [status, setStatus] = useState<RsvpStatus>(initialStatus);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function updateStatus(next: RsvpStatus) {
    if (next === status) return;
    const prev = status;
    if (next === "cancelled" && !window.confirm(t("statusCancelConfirm"))) {
      return;
    }

    setStatus(next);
    setError(null);
    startTransition(async () => {
      try {
        await setRsvpStatus({ eventId, rsvpUid, status: next });
        router.refresh();
      } catch {
        setStatus(prev);
        setError(t("statusUpdateFailed"));
      }
    });
  }

  return (
    <div className="flex min-w-32 flex-col gap-1">
      <select
        value={status}
        disabled={pending}
        onChange={(e) => updateStatus(e.target.value as RsvpStatus)}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`status.${s}`)}
          </option>
        ))}
      </select>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
