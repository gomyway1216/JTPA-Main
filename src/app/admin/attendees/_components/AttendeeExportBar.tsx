"use client";

import { useState } from "react";

import type { RsvpDoc } from "@/lib/types";

type Filter = "confirmed" | "all";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(rsvps: RsvpDoc[]): string {
  const header = [
    "displayName",
    "affiliation",
    "email",
    "role",
    "status",
    "presentationTitle",
    "presentationAbstract",
  ];
  const rows = rsvps.map((r) =>
    [
      r.displayName,
      r.affiliation ?? "",
      r.email,
      r.role,
      r.status,
      r.presentationTitle ?? "",
      r.presentationAbstract ?? "",
    ]
      .map((v) => csvEscape(String(v ?? "")))
      .join(","),
  );
  // Prepend a UTF-8 BOM so Excel opens it without garbled Japanese.
  return "﻿" + [header.join(","), ...rows].join("\n");
}

export function AttendeeExportBar({
  rsvps,
  eventTitle,
}: {
  rsvps: RsvpDoc[];
  eventTitle: string;
}) {
  const [filter, setFilter] = useState<Filter>("confirmed");
  const [toast, setToast] = useState<string | null>(null);

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
      flashToast("該当者なし");
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      flashToast(`${emails.length} 件のメアドをコピー`);
    } catch {
      flashToast("コピー失敗 (HTTPS が必要かも)");
    }
  }

  function downloadCsv() {
    const csv = buildCsv(filtered);
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
      <span className="font-medium">エクスポート:</span>
      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as Filter)}
        className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
      >
        <option value="confirmed">確定参加者のみ</option>
        <option value="all">全て (キャンセル待ち・キャンセル含む)</option>
      </select>
      <span className="text-xs text-zinc-500">
        ({filtered.length} 件 / 全 {rsvps.length} 件)
      </span>
      <button
        type="button"
        onClick={copyEmails}
        className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
      >
        メアドをコピー
      </button>
      <button
        type="button"
        onClick={downloadCsv}
        className="rounded border border-zinc-300 bg-white px-3 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
      >
        CSV ダウンロード
      </button>
      {toast && (
        <span className="text-xs text-emerald-700 dark:text-emerald-300">{toast}</span>
      )}
    </div>
  );
}
