import "server-only";

export type SafeLoadResult<T> = { ok: true; data: T } | { ok: false };

/**
 * Wrap an admin-page data read so a failed Firestore query degrades to an
 * explicit `{ ok: false }` instead of throwing (which would blank the whole
 * page) or silently returning an empty list (which made "query failed" look
 * identical to "no data"). Callers render the failed section empty — same
 * behavior as the old `.catch(() => [])` — but can surface a banner because
 * the failure is now visible in the result. The error is still logged
 * server-side so it stays diagnosable.
 */
export async function safeLoad<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<SafeLoadResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    console.error(`Failed to load ${label}:`, err);
    return { ok: false };
  }
}
