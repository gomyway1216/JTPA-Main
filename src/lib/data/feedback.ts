import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { FeedbackDoc, FeedbackStatus } from "@/lib/types";

function fromSnap(
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): FeedbackDoc {
  const data = doc.data() as Omit<FeedbackDoc, "id">;
  // Defensive nullable defaults for fields that older docs (or docs
  // written by a mistakenly-edited rule version) might be missing.
  // Applied AFTER the spread so the doc's real values aren't clobbered,
  // and using `??` so a stored `null` survives but `undefined` collapses
  // to `null` (the type promises one of those two, never undefined).
  return plainify({
    ...data,
    reviewerUid: data.reviewerUid ?? null,
    reviewerDisplayName: data.reviewerDisplayName ?? null,
    reviewedAt: data.reviewedAt ?? null,
    id: doc.id,
  });
}

/**
 * Admin-facing listing for /admin/feedback. Sorted newest first because
 * triage is "what's new" oriented; the default status filter excludes
 * `archived` so the page stays manageable, and admins can choose to see
 * everything via the dropdown filter.
 *
 * `limit` defaults high enough that a backlog can be cleared in one
 * scroll but low enough that we don't accidentally pull tens of
 * thousands of docs if the form gets spammed.
 */
export async function listFeedback(
  opts: { statuses?: FeedbackStatus[]; limit?: number } = {},
): Promise<FeedbackDoc[]> {
  const { statuses = ["new", "read", "resolved"], limit = 200 } = opts;
  if (statuses.length === 0) return [];
  const snap = await adminDb()
    .collection("feedback")
    .where("status", "in", statuses)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(fromSnap);
}

/**
 * Dashboard counter — number of feedback entries waiting for triage.
 * Used by /admin to render a new-feedback tile. Capped count
 * (>= cap surfaces as "{cap}+") so the count query stays bounded; in
 * practice the queue should never approach the cap.
 */
export async function countNewFeedback(): Promise<number> {
  // `count()` aggregation keeps the read inexpensive — we don't pull the
  // docs themselves just to know how many are unread. Falls back to a
  // doc count walk if the aggregation throws (older emulator versions
  // didn't support it).
  try {
    const snap = await adminDb()
      .collection("feedback")
      .where("status", "==", "new")
      .count()
      .get();
    return snap.data().count;
  } catch (err) {
    console.warn("count() aggregation failed, falling back to list:", err);
    const fallback = await adminDb()
      .collection("feedback")
      .where("status", "==", "new")
      .limit(1000)
      .get();
    return fallback.size;
  }
}
