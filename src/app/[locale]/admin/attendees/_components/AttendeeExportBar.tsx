"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { buildAttendeeCsv } from "@/lib/attendee-csv";
import type { RsvpDoc, SurveyField } from "@/lib/types";

type Filter = "confirmed" | "all";

export function AttendeeExportBar({
  rsvps,
  eventTitle,
  surveyFields = [],
}: {
  rsvps: RsvpDoc[];
  eventTitle: string;
  surveyFields?: SurveyField[];
}) {
  const [filter, setFilter] = useState<Filter>("confirmed");
  const [toast, setToast] = useState<string | null>(null);
  const t = useTranslations("Admin.attendees");
  const common = useTranslations("Admin.common");

  const filtered =
    filter === "all"
      ? rsvps
      : rsvps.filter((r) => r.status === "confirmed");
  const emails = filtered.map((r) => r.email).filter(Boolean);

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2500);
  }

  async function copyEmails() {
    if (emails.length === 0) {
      flashToast(common("noRecipients"));
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      flashToast(common("copiedEmails", { count: emails.length }));
    } catch {
      flashToast(common("copyFailed"));
    }
  }

  function downloadCsv() {
    const csv = buildAttendeeCsv(filtered, surveyFields);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeTitle = eventTitle.replace(/[^\p{L}\p{N}-]+/gu, "_").slice(0, 60);
    a.download = `${safeTitle || "attendees"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="font-medium">{common("export")}</span>
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as Filter)}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
      >
        <option value="confirmed">{t("exportConfirmed")}</option>
        <option value="all">{t("exportAll")}</option>
      </select>
      <span className="text-xs text-zinc-500">
        {common("countAll", { visible: filtered.length, total: rsvps.length })}
      </span>
      <button
        type="button"
        onClick={copyEmails}
        className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
      >
        {common("copyEmails")}
      </button>
      <button
        type="button"
        onClick={downloadCsv}
        className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
      >
        {common("downloadCsv")}
        {surveyFields.length > 0 && (
          <span className="ml-1 text-[10px] text-zinc-500">
            {common("surveyColumns", { count: surveyFields.length })}
          </span>
        )}
      </button>
      {toast && (
        <span className="text-xs text-emerald-700 dark:text-emerald-300">{toast}</span>
      )}
    </div>
  );
}
