import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import type { CommentParentType } from "@/lib/types";

function parentCollection(parentType: CommentParentType): string {
  return parentType === "post" ? "posts" : "guides";
}

/**
 * For the given signed-in user, return the set of "like targets" the user
 * has already liked under this parent. Set members are:
 *
 *   - `RECORD` if the user liked the parent record itself
 *   - `comment:{commentId}` for every comment the user liked
 *
 * The caller passes the list of `commentIds` already fetched for the page
 * so we can do a single `getAll` batched read instead of N+1 round-trips.
 * That's the cheap option in terms of both Firestore document-read cost
 * (still N+1 docs read, but one network round-trip) and latency.
 *
 * Returns an empty Set for anonymous visitors so the caller can use the
 * same code path either way.
 */
export const RECORD_LIKE_KEY = "RECORD";

export async function getMyLikesForParent({
  parentType,
  parentId,
  commentIds,
  uid,
}: {
  parentType: CommentParentType;
  parentId: string;
  commentIds: string[];
  uid: string | null;
}): Promise<Set<string>> {
  if (!uid) return new Set();

  const parentRef = adminDb()
    .collection(parentCollection(parentType))
    .doc(parentId);

  const recordLikeRef = parentRef.collection("likes").doc(uid);
  const commentLikeRefs = commentIds.map((cid) =>
    parentRef.collection("comments").doc(cid).collection("likes").doc(uid),
  );

  // getAll is a batched read — single round-trip, N+1 doc reads. Cheaper
  // than `await Promise.all(refs.map(r => r.get()))` which would issue
  // one RPC per ref.
  const snaps = await adminDb().getAll(recordLikeRef, ...commentLikeRefs);

  const set = new Set<string>();
  if (snaps[0]?.exists) set.add(RECORD_LIKE_KEY);
  commentIds.forEach((cid, i) => {
    if (snaps[i + 1]?.exists) set.add(`comment:${cid}`);
  });
  return set;
}
