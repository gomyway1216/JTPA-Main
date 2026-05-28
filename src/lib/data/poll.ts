import "server-only";

import { adminDb } from "@/lib/firebase/admin";
import { plainify } from "@/lib/data/serialize";
import type { PollDoc, PollStatus, PollVoteDoc } from "@/lib/types";

function fromSnap(doc: FirebaseFirestore.QueryDocumentSnapshot): PollDoc {
  const data = doc.data() as Omit<PollDoc, "id">;
  return plainify({
    // `likeCount` is optional on the type for parity with `qa`/`posts` —
    // defaulting here keeps the runtime shape predictable on the client.
    // `voterCount` is required on the type and always written on create,
    // so it doesn't need a default.
    likeCount: 0,
    ...data,
    id: doc.id,
  });
}

export async function listPoll(
  opts: { statuses?: PollStatus[]; limit?: number } = {},
): Promise<PollDoc[]> {
  const { statuses = ["published"], limit = 50 } = opts;
  // Firestore's `in` rejects empty arrays; bail out so a caller passing
  // `[]` doesn't crash. Mirrors `listQa` in src/lib/data/qa.ts.
  if (statuses.length === 0) return [];
  const snap = await adminDb()
    .collection("polls")
    .where("status", "in", statuses)
    .orderBy("createdAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map(fromSnap);
}

export async function listMyPoll(uid: string): Promise<PollDoc[]> {
  // No status filter — authors can see their own archived polls so they
  // know why they disappeared from the public listing.
  const snap = await adminDb()
    .collection("polls")
    .where("authorUid", "==", uid)
    .orderBy("updatedAt", "desc")
    .limit(100)
    .get();
  return snap.docs.map(fromSnap);
}

export async function getPollById(id: string): Promise<PollDoc | null> {
  const snap = await adminDb().collection("polls").doc(id).get();
  if (!snap.exists) return null;
  return plainify({
    likeCount: 0,
    ...(snap.data() as Omit<PollDoc, "id">),
    id: snap.id,
  });
}

export async function getPollBySlug(slug: string): Promise<PollDoc | null> {
  const snap = await adminDb()
    .collection("polls")
    .where("slug", "==", slug)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return fromSnap(snap.docs[0]);
}

/**
 * Return the current user's ballot on a poll, or null if they haven't
 * voted. Used by the detail page to pre-check the boxes for the options
 * the user has already selected.
 */
export async function getMyPollVote(
  pollId: string,
  uid: string | null,
): Promise<PollVoteDoc | null> {
  if (!uid) return null;
  const snap = await adminDb()
    .collection("polls")
    .doc(pollId)
    .collection("votes")
    .doc(uid)
    .get();
  if (!snap.exists) return null;
  return plainify(snap.data() as PollVoteDoc);
}
