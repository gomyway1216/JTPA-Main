"use client";

import { useEffect, useState } from "react";

/**
 * Inline "✓ 保存しました" toast for forms whose save action stays on the
 * same page (no redirect after save). Hides itself after a few seconds
 * so the form doesn't keep showing a stale confirmation. The caller
 * passes a timestamp (`Date.now()` on success) — re-using the same
 * number does nothing, a new number restarts the visibility timer.
 *
 * Pages where the action `redirect()`s after save (create flows, list
 * pages) don't need this — the navigation itself is the feedback. The
 * forms this is wired into today are GuideForm + EventForm edit modes,
 * which mutate Firestore in place and stay on /admin/{type}/[id]/edit
 * with no visible change.
 */
export function SaveFlash({
  savedAt,
  message = "✓ 保存しました",
  hideAfterMs = 3000,
}: {
  savedAt: number | null;
  message?: string;
  hideAfterMs?: number;
}) {
  // Track which savedAt value we've already let expire. Visibility is
  // derived: we show whenever `savedAt` is non-null AND we haven't yet
  // expired this particular value. We never call setState synchronously
  // inside the effect body — only inside the `setTimeout` callback —
  // which keeps `react-hooks/set-state-in-effect` happy and avoids the
  // cascading-render trap it's guarding against.
  const [expiredAt, setExpiredAt] = useState<number | null>(null);

  useEffect(() => {
    // Nothing showing → no timer to arm. The effect cleanup below is
    // still wired in case a previous timer is still pending from a
    // savedAt that just got swapped out.
    if (savedAt === null) return;
    if (savedAt === expiredAt) return;
    const t = setTimeout(() => setExpiredAt(savedAt), hideAfterMs);
    return () => clearTimeout(t);
  }, [savedAt, expiredAt, hideAfterMs]);

  if (savedAt === null || savedAt === expiredAt) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1 rounded-md bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 dark:bg-green-950 dark:text-green-200"
    >
      {message}
    </p>
  );
}
