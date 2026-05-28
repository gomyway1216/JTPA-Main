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
 * so we can do batched BatchGet reads instead of N+1 round-trips.
 *
 * Returns an empty Set for anonymous visitors so the caller can use the
 * same code path either way.
 */
export const RECORD_LIKE_KEY = "RECORD";

// Firestore's BatchGet caps at 100 documents per request. We split refs
// into chunks just under that ceiling so a busy comment thread (up to
// `COMMENTS_PER_PAGE = 500` in `listComments`) doesn't silently break the
// lookup. The chunk size is slightly under 100 so the record-level like
// ref can always be appended to the first batch without spilling.
const BATCH_GET_LIMIT = 99;

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

  // Pack the record-level ref into the first chunk; remaining comments
  // get their own chunks under the BatchGet ceiling.
  const refChunks: FirebaseFirestore.DocumentReference[][] = [];
  refChunks.push([
    recordLikeRef,
    ...commentLikeRefs.slice(0, BATCH_GET_LIMIT - 1),
  ]);
  for (
    let cursor = BATCH_GET_LIMIT - 1;
    cursor < commentLikeRefs.length;
    cursor += BATCH_GET_LIMIT
  ) {
    refChunks.push(commentLikeRefs.slice(cursor, cursor + BATCH_GET_LIMIT));
  }

  // Run chunked BatchGets in parallel — they're independent and the worst
  // case (commentIds.length = COMMENTS_PER_PAGE = 500) is only a handful
  // of chunks.
  const chunkResults = await Promise.all(
    refChunks.map((refs) => adminDb().getAll(...refs)),
  );
  const allSnaps = chunkResults.flat();

  const set = new Set<string>();
  if (allSnaps[0]?.exists) set.add(RECORD_LIKE_KEY);
  // allSnaps[0] is the record like; allSnaps[1..N] map 1:1 to commentIds.
  commentIds.forEach((cid, i) => {
    if (allSnaps[i + 1]?.exists) set.add(`comment:${cid}`);
  });
  return set;
}
