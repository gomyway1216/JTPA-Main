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
  const [visible, setVisible] = useState(savedAt !== null);

  useEffect(() => {
    if (savedAt === null) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = setTimeout(() => setVisible(false), hideAfterMs);
    return () => clearTimeout(t);
  }, [savedAt, hideAfterMs]);

  if (!visible) return null;

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
