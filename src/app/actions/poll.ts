"use server";

import { randomUUID } from "node:crypto";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";

import { requireAdmin, requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type {
  PollDoc,
  PollOption,
  PollStatus,
  PollVoteDoc,
} from "@/lib/types";
import { slugify } from "@/lib/utils";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

const OptionInputSchema = z.object({
  // Present on edit so existing options keep their stable ids (and their
  // accumulated voteCount). Absent on new options created during edit —
  // the action assigns a fresh id server-side.
  id: z.string().min(1).max(40).optional(),
  label: z.string().trim().min(1).max(80),
});

const PollFormSchema = z.object({
  title: z.string().trim().min(2).max(120),
  // Description is plain text (not Markdown) — polls are short by
  // convention. Empty string is allowed; the UI hides the section when
  // it's blank.
  description: z.string().trim().max(2000).default(""),
  options: z
    .array(OptionInputSchema)
    .min(MIN_OPTIONS, `選択肢は${MIN_OPTIONS}つ以上必要です`)
    .max(MAX_OPTIONS, `選択肢は${MAX_OPTIONS}つまでです`),
  slug: z.string().trim().min(2).max(80).optional(),
});

export type PollFormInput = z.input<typeof PollFormSchema>;

const StatusSchema = z.object({
  pollId: z.string().min(1),
  status: z.enum(["published", "archived"]),
});

export type SetPollStatusInput = z.input<typeof StatusSchema>;

const VoteSchema = z.object({
  pollId: z.string().min(1),
  // Empty array == un-vote (the user clears their selections). The
  // transaction deletes the ballot doc and decrements voterCount in that
  // case.
  optionIds: z.array(z.string().min(1)).max(MAX_OPTIONS),
});

export type CastPollVoteInput = z.input<typeof VoteSchema>;

function readableParse<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  throw new Error(`入力エラー: ${issues}`);
}

// Generate a short stable id for a poll option. Lifted out so future
// callers (e.g. an "add option" admin tool) can mint ids with the same
// shape and the format check in `VoteSchema` continues to match.
function newOptionId(): string {
  return randomUUID().slice(0, 8);
}

// Mirror `findFreeQaSlug` in src/app/actions/qa.ts — try the base slug,
// then append a base36 timestamp on collision, with a randomized
// fallback so we never spin forever in the (pathological) same-ms case.
async function findFreePollSlug(seed: string): Promise<string> {
  const base = slugify(seed, "poll");
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${Date.now().toString(36)}`;
    const snap = await adminDb()
      .collection("polls")
      .where("slug", "==", candidate)
      .limit(1)
      .get();
    if (snap.empty) return candidate;
  }
  return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function submitPoll(input: PollFormInput): Promise<string> {
  const user = await requireUser();
  const parsed = readableParse(PollFormSchema, input);

  // Strip empty/duplicate option labels — the form sends raw text inputs
  // and a user may have deleted the contents of an option without
  // removing the row. We dedupe by trimmed lowercase label so "Claude"
  // and "claude " don't both make it through.
  //
  // Every option id is minted here, ignoring whatever `opt.id` the
  // client sent. On create there are no existing ballots to preserve,
  // and trusting caller-supplied ids would let a crafted request seed
  // two options with the same id — `castPollVote` keys vote diffs by
  // id, so a single ballot for that id would update both rows.
  const seen = new Set<string>();
  const cleanedOptions: PollOption[] = [];
  for (const opt of parsed.options) {
    const key = opt.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleanedOptions.push({
      id: newOptionId(),
      label: opt.label,
      voteCount: 0,
    });
  }
  if (cleanedOptions.length < MIN_OPTIONS) {
    throw new Error(`重複を除いた選択肢が${MIN_OPTIONS}つ未満です`);
  }

  const slug = await findFreePollSlug(parsed.slug || parsed.title);
  const now = Timestamp.now();

  const payload: Omit<PollDoc, "id"> = {
    slug,
    title: parsed.title,
    description: parsed.description,
    options: cleanedOptions,
    authorUid: user.uid,
    authorName: user.displayName,
    authorPhotoURL: user.photoURL,
    status: "published",
    voterCount: 0,
    likeCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await adminDb().collection("polls").add(payload);

  revalidatePath("/poll");
  revalidatePath(`/poll/${slug}`);
  redirect(`/poll/${slug}`);
}

/**
 * Edit a poll. The option list is editable only while there are zero
 * active voters — once anyone has a ballot, rewriting options would
 * orphan their ballot refs and invalidate the denormalized counts.
 * Title/description/slug are always editable. The whole freeze check +
 * write runs inside a Firestore transaction so an author edit can't
 * race with an incoming vote (without it, `updateMyPoll` could read
 * `voterCount == 0`, decide options are editable, then commit after a
 * vote landed and overwrite the now-voted options with zero-count
 * edits).
 */
export async function updateMyPoll(
  pollId: string,
  input: PollFormInput,
): Promise<void> {
  const user = await requireUser();
  const parsed = readableParse(PollFormSchema, input);
  const isAdminCaller = user.isAdmin;

  const ref = adminDb().collection("polls").doc(pollId);

  // Resolve the slug change outside the transaction. `findFreePollSlug`
  // hits the index a few times, which we don't want inside a txn (each
  // read locks the doc and increases retry contention). The slug
  // uniqueness check is best-effort regardless — two concurrent slug
  // edits can still collide; the second one would overwrite the first.
  // Acceptable: slugs aren't a security boundary, just a routing key.
  let newSlug: string | null = null;
  // Need the current slug to know whether the caller asked for a real
  // change. Reading it twice (here + in the txn) is fine — the txn
  // read is the authoritative one for the write.
  const preReadSnap = await ref.get();
  if (!preReadSnap.exists) throw new Error("NOT_FOUND");
  const preRead = preReadSnap.data() as PollDoc;
  if (preRead.authorUid !== user.uid && !isAdminCaller) {
    throw new Error("FORBIDDEN");
  }
  if (parsed.slug && parsed.slug !== preRead.slug) {
    newSlug = await findFreePollSlug(parsed.slug);
  }

  const committed = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error("NOT_FOUND");
    const cur = snap.data() as PollDoc;
    // Re-check ownership inside the txn in case the doc was reassigned
    // between the pre-read and the txn start (paranoid but cheap).
    if (cur.authorUid !== user.uid && !isAdminCaller) {
      throw new Error("FORBIDDEN");
    }

    const optionsFrozen = (cur.voterCount ?? 0) > 0;

    let nextOptions: PollOption[] = cur.options;
    if (!optionsFrozen) {
      // Build the next option list with two independent dedupe sets:
      //   - labels (lowercased) so "Claude" and "claude" can't both land
      //   - ids so a crafted client can't seed two rows with the same id
      // Existing ids that survive both checks are preserved (handy if
      // we add label-edit-preserves-id semantics later); anything else
      // gets a fresh server-minted id. voteCount is always 0 here
      // because the freeze check above guarantees no voters.
      const existingIds = new Set(cur.options.map((o) => o.id));
      const seenLabels = new Set<string>();
      const seenIds = new Set<string>();
      const cleaned: PollOption[] = [];
      for (const opt of parsed.options) {
        const labelKey = opt.label.toLowerCase();
        if (seenLabels.has(labelKey)) continue;
        seenLabels.add(labelKey);
        let id = opt.id;
        if (!id || seenIds.has(id) || !existingIds.has(id)) {
          id = newOptionId();
        }
        seenIds.add(id);
        cleaned.push({ id, label: opt.label, voteCount: 0 });
      }
      if (cleaned.length < MIN_OPTIONS) {
        throw new Error(`重複を除いた選択肢が${MIN_OPTIONS}つ未満です`);
      }
      nextOptions = cleaned;
    }

    tx.update(ref, {
      slug: newSlug ?? cur.slug,
      title: parsed.title,
      description: parsed.description,
      options: nextOptions,
      updatedAt: Timestamp.now(),
    });

    return { slug: newSlug ?? cur.slug, prevSlug: cur.slug };
  });

  revalidatePath("/poll");
  revalidatePath(`/poll/${committed.prevSlug}`);
  if (committed.slug !== committed.prevSlug) {
    revalidatePath(`/poll/${committed.slug}`);
  }
  redirect(`/poll/${committed.slug}`);
}

export async function deleteMyPoll(pollId: string): Promise<void> {
  const user = await requireUser();
  const ref = adminDb().collection("polls").doc(pollId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as PollDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    throw new Error("FORBIDDEN");
  }
  // Subcollections (votes/comments/likes) aren't cascaded — matches the
  // Q&A delete behavior. The parent disappearing makes them unreachable
  // via the UI anyway.
  await ref.delete();
  revalidatePath("/poll");
  revalidatePath(`/poll/${cur.slug}`);
  redirect("/poll");
}

export async function setPollStatus(input: SetPollStatusInput): Promise<void> {
  await requireAdmin();
  const parsed = readableParse(StatusSchema, input);

  const ref = adminDb().collection("polls").doc(parsed.pollId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error("NOT_FOUND");
  const cur = snap.data() as PollDoc;

  if (cur.status === parsed.status) return;
  await ref.update({
    status: parsed.status as PollStatus,
    updatedAt: Timestamp.now(),
  });

  revalidatePath("/poll");
  revalidatePath(`/poll/${cur.slug}`);
}

export interface CastVoteResult {
  optionIds: string[];
  options: PollOption[];
  voterCount: number;
}

/**
 * Cast (or update) the current user's ballot on a poll. Multi-select:
 * the full set of chosen option ids replaces whatever the user had
 * selected before. Pass `[]` to un-vote.
 *
 * The transaction is the load-bearing piece — it reads the parent and
 * the existing ballot, computes per-option deltas, then writes them all
 * atomically so the denormalized counts can never drift from the
 * underlying ballots even under concurrent flips from the same user
 * across tabs.
 */
export async function castPollVote(
  input: CastPollVoteInput,
): Promise<CastVoteResult> {
  const user = await requireUser();
  const parsed = readableParse(VoteSchema, input);

  const pollRef = adminDb().collection("polls").doc(parsed.pollId);
  const voteRef = pollRef.collection("votes").doc(user.uid);

  const result = await adminDb().runTransaction(async (tx) => {
    const [pollSnap, voteSnap] = await Promise.all([
      tx.get(pollRef),
      tx.get(voteRef),
    ]);
    if (!pollSnap.exists) throw new Error("NOT_FOUND");
    const poll = pollSnap.data() as PollDoc;
    if (poll.status !== "published") {
      throw new Error("公開中の投票のみ受け付けています");
    }

    // Validate every incoming optionId actually exists on the poll.
    // Without this guard, a malicious client could inflate the
    // voterCount with phantom ids that never show up in the options
    // array (and so never get counted in the UI).
    const validIds = new Set(poll.options.map((o) => o.id));
    const dedupedNewIds = [...new Set(parsed.optionIds)];
    for (const id of dedupedNewIds) {
      if (!validIds.has(id)) {
        throw new Error("不正な選択肢が含まれています");
      }
    }

    const oldIds = (voteSnap.exists ? (voteSnap.data() as PollVoteDoc).optionIds : []) ?? [];
    const oldSet = new Set(oldIds);
    const newSet = new Set(dedupedNewIds);

    // Per-option delta: +1 for added, -1 for removed, 0 for unchanged.
    // Math.max(0, ...) on the decrement so a legacy/corrupt count of 0
    // can never drive the counter negative (same defensive pattern as
    // `toggleLikeRecord`).
    const updatedOptions: PollOption[] = poll.options.map((opt) => {
      const wasSelected = oldSet.has(opt.id);
      const isSelected = newSet.has(opt.id);
      if (wasSelected === isSelected) return opt;
      const cur = opt.voteCount ?? 0;
      const next = isSelected ? cur + 1 : Math.max(0, cur - 1);
      return { ...opt, voteCount: next };
    });

    // voterCount counts distinct ballots, not selections — going from
    // having a ballot to having none decrements; going from no ballot
    // to any selection increments. Editing an existing ballot (still
    // non-empty) leaves it alone.
    const hadBallot = oldIds.length > 0 && voteSnap.exists;
    const hasBallot = newSet.size > 0;
    const prevVoterCount = poll.voterCount ?? 0;
    let nextVoterCount = prevVoterCount;
    if (!hadBallot && hasBallot) nextVoterCount = prevVoterCount + 1;
    else if (hadBallot && !hasBallot) {
      nextVoterCount = Math.max(0, prevVoterCount - 1);
    }

    const now = Timestamp.now();
    if (hasBallot) {
      // Fall back to `now` when the existing ballot is missing
      // `createdAt`. Shouldn't happen for docs written by this action
      // (it always sets the field), but defending against legacy/manual
      // edits is cheap and avoids writing `undefined` to Firestore.
      const existingCreatedAt = voteSnap.exists
        ? (voteSnap.data() as PollVoteDoc).createdAt
        : null;
      tx.set(voteRef, {
        optionIds: [...newSet],
        createdAt: existingCreatedAt ?? now,
        updatedAt: now,
      });
    } else if (voteSnap.exists) {
      // User cleared all selections — drop the ballot doc entirely so
      // `getMyPollVote` returns null and the UI shows the un-voted state.
      tx.delete(voteRef);
    }
    tx.update(pollRef, {
      options: updatedOptions,
      voterCount: nextVoterCount,
      updatedAt: now,
    });

    return {
      optionIds: [...newSet],
      options: updatedOptions,
      voterCount: nextVoterCount,
      slug: poll.slug,
    };
  });

  // Both pages display voterCount / option results, so revalidate the
  // list as well as the detail. Without /poll the list page would keep
  // showing the pre-vote totals until the next deploy or another
  // unrelated revalidation.
  revalidatePath("/poll");
  revalidatePath(`/poll/${result.slug}`);
  return {
    optionIds: result.optionIds,
    options: result.options,
    voterCount: result.voterCount,
  };
}
