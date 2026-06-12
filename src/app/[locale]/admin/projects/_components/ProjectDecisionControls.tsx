"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { decideProject } from "@/app/actions/projects";

export function ProjectDecisionControls({
  projectId,
}: {
  projectId: string;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("Admin.projects");
  const common = useTranslations("Admin.common");
  const router = useRouter();

  function decide(decision: "approved" | "rejected") {
    setError(null);
    if (decision === "rejected" && !note.trim()) {
      if (!confirm(t("rejectWithoutNoteConfirm"))) return;
    }
    startTransition(async () => {
      try {
        const res = await decideProject(projectId, decision, note);
        if (!res.ok) {
          // Surface the real reason instead of the masked generic crash.
          setError(res.error);
          return;
        }
        // revalidatePath inside the Server Action invalidates the cache, but
        // the existing client tree won't re-fetch until we refresh.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("failed"));
      }
    });
  }

  return (
    <>
      <textarea
        rows={2}
        placeholder={t("notePlaceholder")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="mt-3 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("approved")}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {common("approve")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("rejected")}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950 disabled:opacity-50"
        >
          {common("reject")}
        </button>
      </div>
    </>
  );
}
