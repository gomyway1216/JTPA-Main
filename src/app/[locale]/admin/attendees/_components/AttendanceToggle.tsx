"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setAttendance } from "@/app/actions/check-in";

export function AttendanceToggle({
  eventId,
  rsvpUid,
  initialAttended,
}: {
  eventId: string;
  rsvpUid: string;
  initialAttended: boolean;
}) {
  const router = useRouter();
  const [attended, setAttendedState] = useState(initialAttended);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("Admin.attendees");

  function toggle() {
    const next = !attended;
    // Optimistic flip — server action revalidates the page on success.
    // On failure we roll the local state back.
    setAttendedState(next);
    setError(null);
    startTransition(async () => {
      try {
        await setAttendance(eventId, rsvpUid, next);
        router.refresh();
      } catch (e) {
        setAttendedState(!next);
        setError(e instanceof Error ? e.message : t("attendanceFailed"));
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className={
          attended
            ? "rounded-md bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
            : "rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
        }
      >
        {pending ? "..." : attended ? t("attended") : t("unattended")}
      </button>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
