"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { OptedInRecipient } from "@/lib/data/users-admin";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(recipients: OptedInRecipient[]): string {
  const header = ["email", "displayName", "affiliation"];
  const rows = recipients.map((r) =>
    [r.email, r.displayName, r.affiliation]
      .map((v) => csvEscape(String(v ?? "")))
      .join(","),
  );
  // UTF-8 BOM so Excel opens the file without garbling Japanese names.
  return "﻿" + [header.join(","), ...rows].join("\n");
}

export function EmailRecipientsExportBar({
  recipients,
  totalUsers,
}: {
  recipients: OptedInRecipient[];
  // Total user count from the Firebase Auth list — shown alongside the
  // opted-in count so admins can eyeball the opt-out rate without
  // running a separate query.
  totalUsers: number;
}) {
  const [toast, setToast] = useState<string | null>(null);
  const t = useTranslations("Admin.users");
  const common = useTranslations("Admin.common");

  function flashToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2500);
  }

  async function copyEmails() {
    if (recipients.length === 0) {
      flashToast(common("noRecipients"));
      return;
    }
    try {
      await navigator.clipboard.writeText(
        recipients.map((r) => r.email).join(", "),
      );
      flashToast(common("copiedEmails", { count: recipients.length }));
    } catch {
      flashToast(common("copyFailed"));
    }
  }

  function downloadCsv() {
    if (recipients.length === 0) {
      flashToast(common("noRecipients"));
      return;
    }
    const csv = buildCsv(recipients);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `jtpa-email-recipients-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t("exportTitle")}</span>
        <span className="text-xs text-zinc-500">
          {t("exportCount", {
            recipients: recipients.length,
            total: totalUsers,
          })}
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
        </button>
        {toast && (
          <span className="text-xs text-emerald-700 dark:text-emerald-300">
            {toast}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        {t("exportHelp")}
      </p>
    </div>
  );
}
