import "server-only";

import { FieldPath } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";
import { decodePageCursor, slicePage } from "@/lib/data/page-cursor";
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

export const FEEDBACK_PAGE_SIZE = 50;

export type FeedbackPage = {
  entries: FeedbackDoc[];
  // Opaque cursor for fetching the page after this one (pass it back as
  // `opts.cursor`); null when this page reached the end of the list.
  nextCursor: string | null;
};

/**
 * Admin-facing listing for /admin/feedback. Sorted newest first because
 * triage is "what's new" oriented; the default status filter excludes
 * `archived` so the page stays manageable, and admins can choose to see
 * everything via the dropdown filter.
 *
 * Cursor-paged in (createdAt desc, doc id desc) order so the read stays
 * bounded no matter how big the backlog grows — the explicit doc-id
 * tiebreak matches the implicit __name__ ordering Firestore appends to
 * the existing (status, createdAt desc) composite index, so no new
 * index is needed.
 */
export async function listFeedback(
  opts: {
    statuses?: FeedbackStatus[];
    pageSize?: number;
    cursor?: string | null;
  } = {},
): Promise<FeedbackPage> {
  const {
    statuses = ["new", "read", "resolved"],
    pageSize = FEEDBACK_PAGE_SIZE,
    cursor = null,
  } = opts;
  if (statuses.length === 0) return { entries: [], nextCursor: null };
  let query = adminDb()
    .collection("feedback")
    .where("status", "in", statuses)
    .orderBy("createdAt", "desc")
    .orderBy(FieldPath.documentId(), "desc")
    // Overfetch by one so we know whether another page exists without a
    // separate count() read; `slicePage` drops the extra doc.
    .limit(pageSize + 1);
  // A malformed cursor (hand-edited `?cursor=` URL) decodes to null and
  // falls back to the first page rather than throwing.
  const decoded = cursor ? decodePageCursor(cursor) : null;
  if (decoded) query = query.startAfter(decoded.createdAt, decoded.id);
  const snap = await query.get();
  const { pageDocs, nextCursor } = slicePage(snap.docs, pageSize);
  return { entries: pageDocs.map(fromSnap), nextCursor };
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
