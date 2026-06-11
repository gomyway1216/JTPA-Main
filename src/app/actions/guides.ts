"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath, updateTag } from "next/cache";
import * as z from "zod";

import { findUniqueSlug, parseInput } from "@/lib/actions/shared";
import {
  requireAdmin,
  requireEditor,
  requireUser,
} from "@/lib/auth/session";
import { GUIDES_TAG } from "@/lib/data/cache-tags";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase/admin";
import { actionError } from "@/lib/i18n/action-errors";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import {
  enqueueAdminNewGuideNotification,
  enqueueGuideDecisionNotification,
} from "@/lib/notifications";
import type {
  GuideAuthorRef,
  GuideDoc,
  GuideStatus,
  SessionUser,
} from "@/lib/types";

// Default sort order for community-submitted guides — slotted near the
// end of the list so they don't shove curated guides down. Admin / editor
// can re-rank during review via the order field on the edit form.
const DEFAULT_GUIDE_ORDER = 100;

// Firestore auto-IDs are 20 alphanumeric chars; we accept the same shape
// from the client when a draft id is supplied so we can co-locate
// pre-save image uploads under the eventual doc's path.
const FIRESTORE_AUTO_ID = /^[A-Za-z0-9]{20}$/;

const optionalNonEmpty = (schema: z.ZodTypeAny) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

// Author-facing intents. Mirrors the blog post form:
//   - draft   : keep working on it, not asking for review
//   - pending : submit (or resubmit) for admin approval
//   - published : only honored when the caller is admin/editor/contributor
//     — plain users get downgraded to `pending` server-side.
// The Zod enum allows all three because the same form is shared between
// privileged callers (admin / editor / contributor) and plain users; the
// permission gate lives below in `resolveStatus`.
const StatusInputSchema = z.enum(["draft", "pending", "published"]);

const GuideInputSchema = z.object({
  title: z.string().min(2).max(200),
  slug: optionalNonEmpty(z.string().min(2).max(80).regex(/^[a-z0-9-]+$/)),
  body: z.string().min(1).max(50000),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  status: StatusInputSchema,
  order: z.coerce.number().int().min(0).max(99999).default(100),
});

export type GuideFormInput = z.input<typeof GuideInputSchema>;

// Mutations return a result rather than throwing so the real reason reaches
// the user — Next masks thrown Server Action errors as a generic digest in
// production. `submitGuide` redirects on success; the rest return
// { ok: true }.
export type GuideActionResult = { ok: true } | { ok: false; error: string };

function authorRef(user: {
  uid: string;
  displayName: string;
  email: string;
}): GuideAuthorRef {
  return {
    uid: user.uid,
    displayName: user.displayName || null,
    email: user.email || null,
  };
}

function revalidate(slug?: string) {
  // Expire the cross-request data cache for /guide and /guide/[slug]
  // (see src/lib/data/cached.ts). The collection tag also covers the
  // per-slug detail entries, and the cached data is locale-independent
  // so this hits both locales at once. The path calls below remain for
  // client-router refresh semantics.
  updateTag(GUIDES_TAG);
  revalidatePath("/guide");
  revalidatePath("/admin/guides");
  revalidatePath("/my/guides");
  if (slug) revalidatePath(`/guide/${slug}`);
}

// Caller-status → resolved status. Privileged authors (admin / editor /
// contributor) get whatever they asked for. Plain signed-in users can
// only land in `draft` or `pending`; an attempt to publish gets
// silently downgraded to `pending` so a hand-crafted client form payload
// can't bypass the review queue.
function resolveStatus(
  user: { isAdmin: boolean; isEditor: boolean; isContributor: boolean },
  requested: z.infer<typeof StatusInputSchema>,
): GuideStatus {
  const trusted = user.isAdmin || user.isEditor || user.isContributor;
  if (trusted) return requested;
  return requested === "published" ? "pending" : requested;
}

// Mirrors `requireContributor` semantics but works on a user object the
// caller already has — used for redirects and order-clamp decisions
// where the role is being consulted, not enforced.
function hasCuratorAccess(user: SessionUser): boolean {
  // contributor is NOT included: contributors can self-publish their own
  // guides, but they don't get access to /admin/* or the right to
  // re-order the public guide list. Treat them like plain users for
  // those concerns.
  return user.isAdmin || user.isEditor;
}

// Side-effects that fire when an admin/editor lands a guide in
// `published` for the first time, lifted out of `decideGuide` so the
// same flow can run from `updateGuide` when an admin/editor edits a
// pending submission directly to published via the form. Without this
// shared path, the admin form bypass would silently:
//   - leave `reviewerUid` / `reviewedAt` unset
//   - skip the author's contributor auto-promotion
//   - skip the decision-notification mail
// Returns whether the author was just auto-promoted so the caller can
// thread that into the notification body.
async function autoPromoteAuthor(
  authorUid: string,
  reviewerUid: string,
): Promise<boolean> {
  if (!authorUid || authorUid === reviewerUid) return false;
  try {
    const target = await adminAuth().getUser(authorUid);
    const claims = (target.customClaims ?? {}) as Record<string, unknown>;
    const alreadyTrusted =
      claims.admin === true ||
      claims.editor === true ||
      claims.contributor === true;
    if (alreadyTrusted) return false;
    await adminAuth().setCustomUserClaims(authorUid, {
      ...claims,
      contributor: true,
    });
    // Mirror the new claim into the user's profile doc so the role pill
    // in `AuthorBadge` shows up immediately on the author's next page
    // render. Best-effort — same rationale as the audit write in
    // `setUserRole`: a missing profile doc just means the user never
    // signed in via the app, and the badge will be backfilled by the
    // bootstrap on their next sign-in.
    try {
      await adminDb()
        .collection("users")
        .doc(authorUid)
        .update({ roleBadge: "contributor" });
    } catch (err) {
      console.warn(
        `Failed to mirror contributor role badge for ${authorUid}:`,
        err,
      );
    }
    return true;
  } catch (err) {
    // Promotion is best-effort — the guide approval already landed,
    // and admins can flip the claim manually from /admin/users if
    // this silently fails. Log so it's recoverable.
    console.warn(
      `Failed to auto-promote contributor (uid: ${authorUid}):`,
      err,
    );
    return false;
  }
}

// Fire the author-facing decision email. Best-effort: a failure here
// just means the mail doc didn't get queued, which is recoverable.
async function notifyAuthorOfDecision(
  authorUid: string,
  title: string,
  decision: "published" | "rejected",
  note: string | undefined,
  promoted: boolean,
): Promise<void> {
  if (!authorUid) return;
  try {
    const ownerSnap = await adminDb().collection("users").doc(authorUid).get();
    const ownerEmail = ownerSnap.exists
      ? (ownerSnap.data()?.email as string)
      : null;
    if (!ownerEmail) return;
    await enqueueGuideDecisionNotification({
      to: ownerEmail,
      title,
      decision,
      note: decision === "rejected" ? note : undefined,
      promoted,
    });
  } catch (err) {
    console.warn("Failed to enqueue guide decision notification:", err);
  }
}

// ---------- create ----------

// Replaces the legacy `createGuide` admin-only Server Action. Any
// signed-in user can call this; the resolved status decides whether the
// guide lands publicly (admin/editor/contributor) or in the admin
// review queue (plain user). Form callers should still pass a stable
// `draftId` so client-side image uploads land under the correct
// storage prefix before the Firestore doc exists.
export async function submitGuide(
  input: GuideFormInput,
  draftId?: string,
): Promise<GuideActionResult> {
  const user = await requireUser();
  const pr = await parseInput(GuideInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
  const resolvedStatus = resolveStatus(user, parsed.status);
  const isCurator = hasCuratorAccess(user);

  // `optionalNonEmpty` uses `z.preprocess` which widens the inferred
  // type to `unknown` — cast through the explicit shape so the result
  // type stays narrow downstream (revalidate, payload, etc).
  const requestedSlug = parsed.slug as string | undefined;
  const slug: string =
    requestedSlug ??
    (await findUniqueSlug("guides", parsed.title, { prefix: "guide" }));
  if (requestedSlug) {
    const existing = await adminDb()
      .collection("guides")
      .where("slug", "==", slug)
      .limit(1)
      .get();
    if (!existing.empty) {
      return { ok: false, error: await actionError("slugTaken", { slug }) };
    }
  }

  // Order is a curator-only knob. The form already hides it from
  // non-admin/editor users, but a crafted client payload could
  // otherwise let a contributor pin their guide to the top of the
  // public list with `order: 0`. Force the default for non-curators.
  const resolvedOrder = isCurator ? parsed.order : DEFAULT_GUIDE_ORDER;

  const now = Timestamp.now();
  const author = authorRef(user);
  // Privileged authors skip the review queue, so their published guides
  // never went through "pending" — set `publishedAt` immediately when
  // they land directly in `published`. Plain users always go through
  // pending → admin approve, which sets `publishedAt` in `decideGuide`.
  const publishedAt = resolvedStatus === "published" ? now : null;
  const submittedAt = resolvedStatus === "pending" ? now : null;
  const payload: Record<string, unknown> = {
    slug,
    title: parsed.title,
    body: parsed.body,
    tags: parsed.tags,
    status: resolvedStatus,
    order: resolvedOrder,
    authorUid: user.uid,
    authorName: user.displayName || null,
    authorPhotoURL: user.photoURL,
    reviewerUid: null,
    createdAt: now,
    updatedAt: now,
    createdBy: author,
    updatedBy: author,
  };
  if (publishedAt) payload.publishedAt = publishedAt;
  if (submittedAt) payload.submittedAt = submittedAt;

  let guideId: string;
  if (draftId !== undefined) {
    // Client supplied an id ahead of time so it could upload images to
    // `guides/{guideId}/{uid}/...` before saving. Validate the shape so
    // arbitrary strings don't slip into doc().set().
    if (!FIRESTORE_AUTO_ID.test(draftId)) {
      return { ok: false, error: await actionError("invalidDraftId") };
    }
    const ref = adminDb().collection("guides").doc(draftId);
    // `create()` is atomic — fails with ALREADY_EXISTS instead of
    // clobbering — so we avoid the read-then-write race that a
    // `get()` + `set()` pair would have.
    try {
      await ref.create(payload);
    } catch (err) {
      const e = err as { code?: number | string };
      if (e.code === 6 || e.code === "already-exists") {
        return { ok: false, error: await actionError("draftIdTaken") };
      }
      throw err;
    }
    guideId = draftId;
  } else {
    const ref = await adminDb().collection("guides").add(payload);
    guideId = ref.id;
  }

  // Notify admins on first pending submission so they know to review.
  if (resolvedStatus === "pending") {
    try {
      await enqueueAdminNewGuideNotification({
        guideId,
        title: parsed.title,
        authorName: user.displayName || user.email || user.uid,
        authorEmail: user.email,
      });
    } catch (err) {
      // Best-effort — log and continue. A queued mail doc just means
      // the admin notification didn't ship; the guide submission
      // itself is fine.
      console.warn("Failed to enqueue admin guide notification:", err);
    }
  }

  revalidate(slug);

  // Admin / editor land back on the admin edit page so they can refine
  // and re-save. Contributors and plain authors go to /my/guides — the
  // admin layout would bounce contributors away to "/" (they don't
  // unlock any `/admin/*` route despite being a trusted-author tier).
  if (isCurator) {
    return redirectToLocalizedPath(`/admin/guides/${guideId}/edit`);
  }
  return redirectToLocalizedPath("/my/guides");
}

// Legacy alias kept so existing admin/editor form callers compile during
// the refactor. New code should call `submitGuide` directly.
export const createGuide = submitGuide;

// ---------- update ----------

// Author-facing update. Plain users can save their own guide in
// `draft` / `pending` only; contributors can additionally self-publish.
// Admin/editor edits flow through here too (they're trusted authors)
// but they typically use `decideGuide` / `publishGuide` for status
// transitions and this form for content edits — see `updateGuideAdmin`
// for the cross-author edit path used by /admin/guides/[id]/edit.
export async function updateGuide(
  guideId: string,
  input: GuideFormInput,
): Promise<GuideActionResult> {
  const user = await requireUser();
  const pr = await parseInput(GuideInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
  const ref = adminDb().collection("guides").doc(guideId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("guideNotFound") };
  const cur = snap.data() as GuideDoc;

  // Privileged tiers (admin / editor) can edit any guide. Contributors
  // and plain authors can only touch their own.
  const ownerUid = cur.authorUid ?? cur.createdBy?.uid;
  const isCurator = hasCuratorAccess(user);
  if (!isCurator && ownerUid !== user.uid) {
    return { ok: false, error: await actionError("guideEditForbidden") };
  }

  // Same `unknown`-widening hazard from `optionalNonEmpty` as in
  // `submitGuide` above — narrow once for the rest of the function.
  const requestedSlug = parsed.slug as string | undefined;
  if (requestedSlug && requestedSlug !== cur.slug) {
    const conflict = await adminDb()
      .collection("guides")
      .where("slug", "==", requestedSlug)
      .limit(2)
      .get();
    if (conflict.docs.some((d) => d.id !== guideId)) {
      return {
        ok: false,
        error: await actionError("slugTaken", { slug: requestedSlug }),
      };
    }
  }

  // Same intent → status resolution as `submitGuide`. Admin/editor can
  // freely change status; contributors can self-publish their own;
  // plain users are clamped to draft/pending.
  const requestedStatus = isCurator
    ? parsed.status
    : resolveStatus(user, parsed.status);

  // Order is curator-only. Non-curators always preserve the current
  // value (or fall through to the default when the doc predates the
  // field) so a crafted contributor payload can't reorder the public
  // guide list — matches the `order` clamp in submitGuide.
  const resolvedOrder = isCurator
    ? parsed.order
    : (cur.order ?? DEFAULT_GUIDE_ORDER);

  // When an admin/editor approves a community submission directly from
  // the edit form (pending → published) we need to run the same side
  // effects `decideGuide` would: stamp reviewer + reviewedAt, auto-
  // promote the author to contributor on first approval, and queue the
  // decision-notification email. Without this, the form's publish button
  // button is a silent bypass.
  const isApprovingPending =
    isCurator &&
    requestedStatus === "published" &&
    cur.status === "pending" &&
    ownerUid !== undefined &&
    ownerUid !== user.uid;

  // First-publish detection — anchored on `publishedAt`, like posts —
  // so re-publishing an edited guide that was already public doesn't
  // overwrite the original publish date.
  const becomesPublished =
    requestedStatus === "published" && !cur.publishedAt;
  const becomesPending =
    requestedStatus === "pending" && cur.status !== "pending";

  await ref.update({
    ...(requestedSlug ? { slug: requestedSlug } : {}),
    title: parsed.title,
    body: parsed.body,
    tags: parsed.tags,
    status: requestedStatus,
    order: resolvedOrder,
    ...(isApprovingPending
      ? {
          reviewerUid: user.uid,
          // Clear any stale rejection note that may be lingering on the
          // doc from a previous review round.
          reviewNote: "",
          reviewedAt: FieldValue.serverTimestamp(),
        }
      : {}),
    ...(becomesPublished ? { publishedAt: Timestamp.now() } : {}),
    ...(becomesPending ? { submittedAt: Timestamp.now() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: authorRef(user),
  });

  // Side-effects run AFTER the doc write so the public state is
  // consistent first — a failed promotion or notification doesn't roll
  // the approval back.
  if (isApprovingPending && ownerUid) {
    const promoted = await autoPromoteAuthor(ownerUid, user.uid);
    await notifyAuthorOfDecision(
      ownerUid,
      parsed.title,
      "published",
      undefined,
      promoted,
    );
  }

  revalidate(requestedSlug ?? cur.slug);
  return { ok: true };
}

// ---------- delete ----------

export async function deleteGuide(
  guideId: string,
): Promise<GuideActionResult> {
  const user = await requireUser();
  const ref = adminDb().collection("guides").doc(guideId);
  const snap = await ref.get();
  if (!snap.exists) {
    // Idempotent — silent success if the guide is already gone.
    return { ok: true };
  }
  const cur = snap.data() as GuideDoc;
  const ownerUid = cur.authorUid ?? cur.createdBy?.uid;
  const isAdminOrEditor = user.isAdmin || user.isEditor;
  if (!isAdminOrEditor && ownerUid !== user.uid) {
    return { ok: false, error: await actionError("guideDeleteForbidden") };
  }

  await ref.delete();

  // Best-effort cleanup of any uploaded images. Logged and swallowed so a
  // Storage hiccup can't leave a half-deleted guide in Firestore; an
  // orphaned image is recoverable, a phantom Firestore doc is worse.
  // The prefix sweep catches both the new `guides/{id}/{uid}/...` layout
  // and the legacy flat `guides/{id}/...` layout.
  try {
    await adminStorage()
      .bucket()
      .deleteFiles({ prefix: `guides/${guideId}/` });
  } catch (err) {
    console.warn(`Failed to clean up Storage for guide ${guideId}:`, err);
  }

  revalidate(cur.slug);
  return { ok: true };
}

// ---------- admin review queue ----------

// Approve or reject a pending guide. Mirrors `decidePost`. Admin AND
// editor can call this — editors hold the cross-author curation power,
// so they're trusted to clear the review queue alongside admins.
//
// On the first approval for a given author, we also flip on the
// `contributor: true` custom claim so the author's subsequent guides
// skip the review queue. The promotion is idempotent — re-approving a
// guide from someone who is already admin/editor/contributor doesn't
// re-grant or notify about the role change.
//
// The shared side-effect helpers (`autoPromoteAuthor`,
// `notifyAuthorOfDecision`) are also reused from `updateGuide` so an
// admin/editor approving via the edit form rather than the review card
// doesn't silently bypass promotion + notification.
export async function decideGuide(
  guideId: string,
  decision: "published" | "rejected",
  note?: string,
): Promise<GuideActionResult> {
  const reviewer = await requireEditor();
  const ref = adminDb().collection("guides").doc(guideId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("guideNotFound") };
  const cur = snap.data() as GuideDoc;

  const isFirstPublish = decision === "published" && !cur.publishedAt;
  const isRejection = decision === "rejected";

  await ref.update({
    status: decision,
    reviewerUid: reviewer.uid,
    // Clear any stale rejection note on approval so the previous round's
    // critique doesn't follow an approved guide forever.
    reviewNote: isRejection ? (note ?? "") : "",
    ...(isFirstPublish ? { publishedAt: Timestamp.now() } : {}),
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Auto-promote + notify only on a first-time publish (or on any
  // rejection for the notify side). Re-publishing a previously-public
  // guide that was bounced back to pending shouldn't re-promote or
  // re-email.
  const authorUid = cur.authorUid ?? cur.createdBy?.uid;
  let promoted = false;
  if (decision === "published" && authorUid) {
    promoted = await autoPromoteAuthor(authorUid, reviewer.uid);
  }
  if ((isRejection || isFirstPublish) && authorUid) {
    await notifyAuthorOfDecision(
      authorUid,
      cur.title,
      decision,
      note,
      promoted,
    );
  }

  revalidate(cur.slug);
  return { ok: true };
}

// Admin-only shortcut: publish a draft directly, without going through
// the pending → review handshake. Used for guides admins authored
// themselves (or for republishing an archived guide).
export async function publishGuide(
  guideId: string,
): Promise<GuideActionResult> {
  await requireEditor();
  const ref = adminDb().collection("guides").doc(guideId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("guideNotFound") };
  const cur = snap.data() as GuideDoc;
  const isFirstPublish = !cur.publishedAt;
  await ref.update({
    status: "published" as const,
    ...(isFirstPublish ? { publishedAt: Timestamp.now() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
  revalidate(cur.slug);
  return { ok: true };
}

// Admin-only retire. Same shape as `archivePost`. Not wired into the UI
// yet — kept ready for an archive button on the published guides
// list so guides can be retired without losing the doc.
export async function archiveGuide(
  guideId: string,
): Promise<GuideActionResult> {
  await requireAdmin();
  const ref = adminDb().collection("guides").doc(guideId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("guideNotFound") };
  const cur = snap.data() as GuideDoc;
  await ref.update({
    status: "archived" as const,
    updatedAt: FieldValue.serverTimestamp(),
  });
  revalidate(cur.slug);
  return { ok: true };
}
