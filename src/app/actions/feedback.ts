"use server";

import { Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { requireEditor, requireUser } from "@/lib/auth/session";
import { getMyProfile } from "@/lib/data/users";
import { adminDb } from "@/lib/firebase/admin";
import { actionError, inputError } from "@/lib/i18n/action-errors";
import {
  enqueueAdminNewFeedbackNotification,
} from "@/lib/notifications";
import type { FeedbackStatus } from "@/lib/types";

const BODY_MIN = 4;
const BODY_MAX = 2000;

const SubmitSchema = z.object({
  body: z.string().trim().min(BODY_MIN).max(BODY_MAX),
});

export type SubmitFeedbackInput = z.input<typeof SubmitSchema>;

const StatusSchema = z.object({
  feedbackId: z.string().min(1),
  status: z.enum(["new", "read", "resolved", "archived"]),
});

export type SetFeedbackStatusInput = z.input<typeof StatusSchema>;

async function readableParse<T extends z.ZodTypeAny>(
  schema: T,
  input: z.input<T>,
): Promise<z.infer<T>> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(await inputError(result.error.issues));
}

/**
 * Submit a help-page feedback entry. Login-required: the submitter's
 * identity is taken from the session, NOT from the client payload, so
 * the `authorUid` on the saved doc is always authentic.
 *
 * Returns the new doc id so the caller can show a confirmation toast.
 */
export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<{ id: string }> {
  const user = await requireUser();
  const parsed = await readableParse(SubmitSchema, input);

  // Pull the latest username/displayName from the profile doc rather
  // than trust the session — the session is cached and may not reflect
  // a recent /my/profile rename. Best-effort: a missing doc just means
  // we fall back to the session-side fields.
  const profile = await getMyProfile(user.uid).catch(() => null);

  const ref = await adminDb()
    .collection("feedback")
    .add({
      body: parsed.body,
      authorUid: user.uid,
      authorEmail: user.email || null,
      authorDisplayName: profile?.displayName ?? user.displayName ?? null,
      authorUsername: profile?.username ?? null,
      status: "new" satisfies FeedbackStatus,
      reviewerUid: null,
      reviewerDisplayName: null,
      reviewedAt: null,
      createdAt: Timestamp.now(),
    });

  // Fire-and-forget admin notification. Failure here can't reject the
  // submit — the doc already landed and admins can also see the entry
  // in /admin/feedback even if mail dispatch hits a snag.
  enqueueAdminNewFeedbackNotification({
    feedbackId: ref.id,
    body: parsed.body,
    authorName: profile?.displayName ?? user.displayName ?? "(unknown)",
    authorEmail: user.email || "(no email)",
  }).catch((err) => {
    console.warn("Failed to enqueue admin feedback notification:", err);
  });

  revalidatePath("/admin/feedback");
  revalidatePath("/admin");
  return { id: ref.id };
}

/**
 * Triage transition. Editor+ only — keeping it editor-level so the
 * triage workload can be shared without granting the editor full admin
 * powers. Admins inherit this through the `requireEditor` ladder.
 *
 * Records the actor + timestamp on the doc so the admin list can show
 * "marked read by @yudai" without a second query.
 */
export async function setFeedbackStatus(
  input: SetFeedbackStatusInput,
): Promise<void> {
  const actor = await requireEditor();
  const parsed = await readableParse(StatusSchema, input);

  // `archived` is the "hide from default triage" terminal status —
  // gated to admins only so editors can't unilaterally remove entries
  // from the queue. Matches the UI (the archive button only renders
  // for admins) and the Firestore rule. Per PR #88 Gemini security
  // review — the UI guard alone isn't load-bearing.
  if (parsed.status === "archived" && !actor.isAdmin) {
    throw new Error(await actionError("feedbackArchiveAdminOnly"));
  }

  const ref = adminDb().collection("feedback").doc(parsed.feedbackId);
  await ref.update({
    status: parsed.status,
    // When flipping back to `new` (a "I shouldn't have closed this"
    // un-triage), wipe the reviewer fields so the list doesn't
    // misleadingly show a stale "marked read by …" attribution. Every
    // other transition carries the current actor.
    reviewerUid: parsed.status === "new" ? null : actor.uid,
    reviewerDisplayName:
      parsed.status === "new" ? null : actor.displayName || null,
    reviewedAt: parsed.status === "new" ? null : Timestamp.now(),
  });

  revalidatePath("/admin/feedback");
  revalidatePath("/admin");
}
