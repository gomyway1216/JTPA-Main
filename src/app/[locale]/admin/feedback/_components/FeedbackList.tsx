"use client";

import { useMemo, useState, useTransition } from "react";

import { setFeedbackStatus } from "@/app/actions/feedback";
import type { FeedbackDoc, FeedbackStatus } from "@/lib/types";
import { formatDate } from "@/lib/utils";

type Filter = FeedbackStatus | "all";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "new", label: "未対応" },
  { value: "read", label: "確認済み" },
  { value: "resolved", label: "対応済み" },
  { value: "archived", label: "アーカイブ" },
  { value: "all", label: "すべて" },
];

interface Props {
  entries: FeedbackDoc[];
  // `archived` and `delete` are admin-only. The action layer enforces
  // this too — this prop just controls whether the buttons render.
  viewerIsAdmin: boolean;
}

// Client-side triage UI. Buckets the server-supplied list by status and
// renders a toolbar of filters plus inline status-flip buttons per
// entry. We keep the server data static (no re-fetch) and apply
// optimistic in-place mutations so the page doesn't jank between
// clicks; the Server Action's `revalidatePath` will pick up the
// authoritative value on the next render.
export function FeedbackList({ entries, viewerIsAdmin }: Props) {
  const [filter, setFilter] = useState<Filter>("new");

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => e.status === filter);
  }, [entries, filter]);

  // Bucket counts displayed on the filter tabs so editors know at a
  // glance how much triage is left.
  const counts = useMemo(() => {
    const out: Record<FeedbackStatus, number> = {
      new: 0,
      read: 0,
      resolved: 0,
      archived: 0,
    };
    for (const e of entries) out[e.status] = (out[e.status] ?? 0) + 1;
    return out;
  }, [entries]);

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => {
          const isActive = filter === f.value;
          const count =
            f.value === "all" ? entries.length : counts[f.value as FeedbackStatus];
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-md border px-3 py-1.5 text-xs ${
                isActive
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </nav>

      {visible.length === 0 ? (
        <p className="text-sm text-zinc-500">該当するエントリはありません。</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((entry) => (
            <FeedbackRow
              key={entry.id}
              entry={entry}
              viewerIsAdmin={viewerIsAdmin}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedbackRow({
  entry,
  viewerIsAdmin,
}: {
  entry: FeedbackDoc;
  viewerIsAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<FeedbackStatus>(entry.status);
  // Track the prop value we last seeded `status` from so we can re-sync
  // when the parent re-renders with fresh server data (after a
  // revalidate, or after another admin updated the row from a different
  // tab). `useState` only runs its initializer once, so without this
  // dance the local optimistic status would shadow the new server
  // value forever. Per PR #88 Gemini review.
  const [seedStatus, setSeedStatus] = useState<FeedbackStatus>(entry.status);
  if (entry.status !== seedStatus) {
    setSeedStatus(entry.status);
    setStatus(entry.status);
  }
  const [error, setError] = useState<string | null>(null);

  function flip(next: FeedbackStatus) {
    if (pending || next === status) return;
    const prev = status;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      try {
        const res = await setFeedbackStatus({
          feedbackId: entry.id,
          status: next,
        });
        if (!res.ok) {
          // Revert the optimistic flip and surface the real reason (e.g.
          // editor attempting an admin-only archive) instead of the masked
          // generic Server Action crash.
          setStatus(prev);
          setError(res.error);
        }
      } catch (err) {
        setStatus(prev);
        setError(err instanceof Error ? err.message : "更新に失敗しました");
      }
    });
  }

  const statusCls =
    status === "new"
      ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      : status === "read"
        ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"
        : status === "resolved"
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
  const statusLabel =
    status === "new"
      ? "未対応"
      : status === "read"
        ? "確認済み"
        : status === "resolved"
          ? "対応済み"
          : "アーカイブ";

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="text-xs text-zinc-500">
          <span className={`mr-2 inline-flex rounded border px-1.5 py-0.5 ${statusCls}`}>
            {statusLabel}
          </span>
          {formatDate(entry.createdAt)} · {entry.authorDisplayName ?? "(不明)"}
          {entry.authorUsername ? ` (@${entry.authorUsername})` : ""}
          {entry.authorEmail ? ` · ${entry.authorEmail}` : ""}
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {status !== "read" && (
            <FlipButton
              label="確認済みに"
              onClick={() => flip("read")}
              pending={pending}
            />
          )}
          {status !== "resolved" && (
            <FlipButton
              label="対応済みに"
              onClick={() => flip("resolved")}
              pending={pending}
            />
          )}
          {status !== "new" && (
            <FlipButton
              label="未対応に戻す"
              onClick={() => flip("new")}
              pending={pending}
            />
          )}
          {viewerIsAdmin && status !== "archived" && (
            <FlipButton
              label="アーカイブ"
              onClick={() => flip("archived")}
              pending={pending}
            />
          )}
        </div>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-200">
        {entry.body}
      </p>
      {entry.reviewerDisplayName && status !== "new" && (
        <p className="mt-2 text-xs text-zinc-500">
          {entry.reviewerDisplayName} が {formatDate(entry.reviewedAt)} に
          ステータスを変更
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function FlipButton({
  label,
  onClick,
  pending,
}: {
  label: string;
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {label}
    </button>
  );
}
