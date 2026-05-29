import type { Timestamp } from "firebase/firestore";

// Firestore timestamps round-trip differently between client/admin SDKs,
// and again across the Server→Client component boundary (JSON-stringified
// Admin Timestamps emit `_seconds`/`_nanoseconds`). All Date-like fields
// use this helper type to cover every shape we might encounter.
export type TsLike =
  | Timestamp
  | Date
  | { seconds: number; nanoseconds: number }
  | { _seconds: number; _nanoseconds: number };

// ---------- users ----------
// Per-user external links shown as icons on the public /u/[uid] page.
// `sns` is intentionally a generic slot — the UI inspects the URL's host
// to pick an icon (X, Instagram, Threads, Bluesky, Mastodon, …) and falls
// back to a generic SNS glyph for unknown hosts. Each field stores the
// full URL or is omitted entirely; empty strings are normalized to missing
// on write so the public projection doesn't render empty <a> tags.
export interface UserLinks {
  portfolio?: string;
  github?: string;
  linkedin?: string;
  sns?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  // Source of truth for the human-typed "real name" surface. Bootstrapped
  // from the Google account on first sign-in and refreshed on every
  // sign-in so renames in Google propagate, but it's only ever displayed
  // when `fullNamePublic` is true. The username (below) is what's shown
  // by default everywhere else.
  displayName: string;
  photoURL?: string;
  // Stable, user-facing handle (e.g. "yudai"). Unique across all users
  // via a transactional reservation in `usernames/{username}` →
  // `{uid}`. Format enforced by USERNAME_REGEX. Bootstrapped to
  // `user-<6chars-of-uid>` on first sign-in and on any existing-user
  // sign-in that pre-dates this field; users can rename via
  // /my/profile. Optional in the type only so docs written before this
  // field exists still typecheck — every read path treats a missing
  // username as a migration trigger.
  username?: string;
  affiliation?: string;
  // Plain-text self-introduction shown on the public /u/[uid] page when
  // `bioPublic` is true. Multi-line; newlines are rendered with
  // whitespace-pre-wrap.
  bio?: string;
  // Per-field public/private toggles. Default-false (private) on older
  // docs that pre-date these fields — opt-in is the safer migration.
  // email itself is intentionally NEVER user-toggleable (PII / spam
  // surface); the public profile page only ever shows username,
  // photoURL, the conditionally-public displayName, and whichever of
  // affiliation/bio/links the user has opted to publish.
  affiliationPublic?: boolean;
  bioPublic?: boolean;
  // Controls whether the Google-account `displayName` (real / full name)
  // is shown on the public /u/[uid] page and as a secondary label next
  // to the @username badge. Default false so signup never silently
  // exposes a real name — users opt in from /my/profile.
  fullNamePublic?: boolean;
  // External links — always public when set. The shape is a small fixed
  // record (not an array) so additions stay backwards-compatible and
  // the edit form can render four labeled inputs without an "add row"
  // dance. See UserLinks for the per-slot semantics (especially the
  // generic `sns` slot).
  links?: UserLinks;
  emailOptIn: boolean;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// `usernames/{username}` reservation. Doc id IS the username; the body
// just carries the owning uid so a lookup can resolve "which user owns
// this handle" without a query. Created/updated/deleted transactionally
// alongside the `users/{uid}.username` field so the two never diverge.
export interface UsernameReservationDoc {
  uid: string;
  createdAt: TsLike;
}

// ---------- events ----------
export type EventStatus = "draft" | "published" | "past" | "cancelled";
export type LocationType = "online" | "offline" | "hybrid";
// `members_only` hides the event from logged-out visitors. Older docs without
// the field are treated as `public` everywhere it's checked.
export type EventVisibility = "public" | "members_only";

export interface SurveyField {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox";
  required: boolean;
  options?: string[];
  audience: "all" | "presenter";
}

export interface EventDoc {
  id: string;
  slug: string;
  title: string;
  description: string;
  startAt: TsLike;
  endAt: TsLike;
  location: {
    type: LocationType;
    address?: string;
    mapUrl?: string;
    meetingUrl?: string;
  };
  capacity: number;
  presenterCapacity: number;
  status: EventStatus;
  visibility?: EventVisibility;
  // Cover image shown on /events cards + at the top of /events/[slug].
  // Uses the same {path, url} shape as ProjectDoc.thumbnail and
  // PostDoc.coverImage so the upload helpers in those forms transfer.
  coverImage?: ProjectAsset;
  surveyFields: SurveyField[];
  rsvpCount: number;
  presenterCount: number;
  waitlistCount: number;
  // Opaque random token used as the QR-code query param for self check-in.
  // Missing until an admin generates one. Admin can regenerate at any time
  // to invalidate a leaked code. Pair with the event date window so a leaked
  // token can't be used outside the actual event.
  checkInToken?: string;
  // Denormalized count of RSVPs with `attendedAt` set. Maintained
  // transactionally with each check-in. Missing = 0 on older docs.
  attendanceCount?: number;
  createdBy: string;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// ---------- rsvps ----------
export type RsvpRole = "attendee" | "presenter";
export type RsvpStatus = "confirmed" | "waitlist" | "cancelled";

export interface RsvpDoc {
  uid: string;
  displayName: string;
  email: string;
  affiliation?: string;
  role: RsvpRole;
  status: RsvpStatus;
  surveyResponses: Record<string, string | string[] | boolean>;
  presentationTitle?: string;
  presentationAbstract?: string;
  // Set when the attendee checks in at the venue. Missing = not checked in.
  attendedAt?: TsLike;
  // True for walk-in guests who came via the anonymous-auth check-in flow
  // (no Google account, no `users/{uid}` profile). For those docs, the
  // `displayName` and `email` here are the only identity we have for them.
  isGuest?: boolean;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// ---------- presentations ----------
// One presenter can register multiple presentations per event. Each doc is
// keyed by a Firestore auto-id (NOT by uid) so the same presenter can have
// several slides/talks attached. `filePath` and `externalSlidesUrl` are both
// optional and can co-exist (e.g. PDF slides + a YouTube recording link).
export interface PresentationDoc {
  id: string;
  eventId: string;
  presenterUid: string;
  presenterName: string;
  title: string;
  abstract?: string;
  filePath?: string;
  fileUrl?: string;
  fileName?: string;
  externalSlidesUrl?: string;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// ---------- projects (Showcase) ----------
export type ProjectStatus = "pending" | "approved" | "rejected" | "archived";

// Both fields are needed because Firebase Storage download URLs include a
// token; we can't reconstruct them from the path alone. We keep the path so
// the Server Action can delete the underlying Storage object on
// replacement/deletion.
export interface ProjectAsset {
  path: string;
  url: string;
}

export interface ProjectDoc {
  id: string;
  slug: string;
  ownerUid: string;
  ownerName: string;
  title: string;
  description: string;
  tags: string[];
  appUrl: string;
  repoUrl?: string;
  demoVideoUrl?: string;
  thumbnail?: ProjectAsset;
  screenshots: ProjectAsset[];
  status: ProjectStatus;
  reviewerUid: string | null;
  reviewNote?: string;
  // Denormalized like count for the showcase. Missing = 0 on legacy docs.
  likeCount?: number;
  submittedAt: TsLike;
  reviewedAt?: TsLike;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// Session payload from verified Firebase session cookie.
export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  isAdmin: boolean;
  isEditor: boolean;
  // `contributor: true` lets the user self-publish guides without going
  // through admin review. Strictly less privileged than `editor` — a
  // contributor can only edit / publish guides they themselves authored,
  // not anyone else's. Auto-granted on the first admin-approved guide
  // submission so that follow-up posts skip the review queue.
  isContributor: boolean;
}

// ---------- blog posts ----------
// Distinct from `guides`. Guides are admin/editor-curated help content with
// no comments and a manual `order`. Posts are chronological community blog
// entries that any signed-in member can submit; admins review before public
// release. Comments live in a subcollection.
export type PostStatus =
  | "draft"
  | "pending"
  | "published"
  | "rejected"
  | "archived";

export interface PostDoc {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  coverImage?: ProjectAsset; // reuse the {path, url} shape from projects
  tags: string[];
  authorUid: string;
  authorName: string;
  authorPhotoURL: string | null;
  status: PostStatus;
  reviewerUid: string | null;
  reviewNote?: string;
  publishedAt?: TsLike;
  submittedAt: TsLike;
  reviewedAt?: TsLike;
  // Denormalized like count. Old docs may not have it; treat missing as 0.
  likeCount?: number;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// ---------- comments + likes (shared across post + guide + qa + project + poll) ----------
// Comments and likes use parallel subcollections under `posts/`, `guides/`,
// `qa/`, `projects/`, and `polls/`. The shapes are identical; only the
// parent collection differs.
export type CommentParentType = "post" | "guide" | "qa" | "project" | "poll";

export interface CommentDoc {
  id: string;
  // Denormalized so the client doesn't have to re-derive from the parent
  // path. Useful for cross-parent activity feeds later.
  parentType: CommentParentType;
  parentId: string;
  authorUid: string;
  authorName: string;
  authorPhotoURL: string | null;
  body: string;
  // Null/missing = top-level comment. Otherwise references another comment
  // in the same subcollection — we render this as a linear thread with a
  // "Re: @author" prefix rather than a nested tree (per Jin/Yudai design).
  parentCommentId?: string | null;
  // Denormalized like count. Missing = 0 on older docs.
  likeCount?: number;
  // Set when soft-deleted. Body is also cleared at that point. Hard delete
  // (admin-only) removes the doc entirely. Null/missing on live comments.
  deletedAt?: TsLike | null;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// Legacy alias kept so existing callers compile during the refactor; new
// code should use `CommentDoc` directly.
export type PostCommentDoc = CommentDoc;

// `likes/{uid}` subcollection doc. Existence == liked; we don't store the
// uid in the body because it's already the doc id.
export interface LikeDoc {
  createdAt: TsLike;
}

// ---------- guides (AI setup / help content) ----------
// Originally admin/editor-only curated reference docs. With the addition
// of the `contributor` role and community-submission flow, guides now
// share the moderation shape with `posts`:
//   - draft / pending: author still iterating or waiting for review
//   - published      : visible to everyone on /guide
//   - rejected       : admin sent it back with a note
//   - archived       : admin retired without deleting
// admin and editor can author/publish directly (no pending step);
// contributors can self-publish their own guides; plain signed-in users
// submit as `pending` and wait for admin approval.
export type GuideStatus =
  | "draft"
  | "pending"
  | "published"
  | "rejected"
  | "archived";

export interface GuideAuthorRef {
  uid: string;
  displayName: string | null;
  email: string | null;
}

export interface GuideDoc {
  id: string;
  slug: string;
  title: string;
  body: string;
  tags: string[];
  status: GuideStatus;
  order: number;
  // Author identity, denormalized in the same shape as posts/qa/polls so
  // shared query paths (`listMyGuides`, /my/likes activity feeds, etc.)
  // can scan one field. Optional on legacy admin/editor guides created
  // before the community flow — read paths fall back to `createdBy.uid`
  // when unset.
  authorUid?: string;
  authorName?: string;
  authorPhotoURL?: string | null;
  // Review metadata, mirroring PostDoc. Set by admin when a community
  // submission is approved or rejected; `null`/missing on guides created
  // directly by an admin/editor (which skip the review queue).
  reviewerUid?: string | null;
  reviewNote?: string;
  // Set when the guide first transitioned to `published`. Same first-
  // publish-detection trick as posts so re-publishing an edited guide
  // doesn't overwrite the original publish date.
  publishedAt?: TsLike;
  submittedAt?: TsLike;
  reviewedAt?: TsLike;
  // Denormalized like count. Old docs may not have it; treat missing as 0.
  likeCount?: number;
  createdAt: TsLike;
  updatedAt: TsLike;
  createdBy: GuideAuthorRef;
  updatedBy: GuideAuthorRef;
}

// ---------- site pages (admin-edited static-ish content) ----------
// One Firestore doc per slug under `sitePages/{slug}` — `/about` is the
// only consumer today. The page renders fallback content when the doc is
// absent, so a fresh deploy stays readable before an admin saves anything.
export interface SitePageDoc {
  id: string;
  slug: string;
  title: string;
  body: string;
  updatedAt: TsLike;
  updatedBy: GuideAuthorRef;
}

// ---------- Q&A (community-posted questions / tips) ----------
// Open to any signed-in user, unlike `guides` (admin/editor-curated) or
// `posts` (admin-moderated before publish). No review queue: anything
// posted lands as `published` immediately. Admins can flip a Q&A to
// `archived` to hide spam after the fact.
export type QaStatus = "published" | "archived";

export interface QaDoc {
  id: string;
  slug: string;
  title: string;
  body: string; // Markdown
  tags: string[];
  authorUid: string;
  authorName: string;
  authorPhotoURL: string | null;
  status: QaStatus;
  // Denormalized like count. Missing = 0 on docs that predate the field.
  likeCount?: number;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// ---------- polls (community-posted polls / votes) ----------
// Polls are multi-select by design: a voter picks any subset of the
// `options` array, and can change that selection at any time. Options are
// fixed at creation; the author can edit title/description later but the
// option list is frozen so denormalized counts stay meaningful.
export type PollStatus = "published" | "archived";

export interface PollOption {
  // Stable id assigned at creation. Used as the key in `PollVoteDoc.optionIds`
  // and to address option count updates transactionally, so renaming an
  // option label later doesn't reshuffle the vote tallies.
  id: string;
  label: string;
  // Denormalized count of voters who selected this option. Updated
  // transactionally alongside `polls/{id}/votes/{uid}` writes.
  voteCount: number;
}

export interface PollDoc {
  id: string;
  slug: string;
  title: string;
  // Optional Markdown context for the poll (e.g. "Reply 'other' in the
  // comments"). Body is short by convention — polls aren't long-form.
  description: string;
  options: PollOption[];
  authorUid: string;
  authorName: string;
  authorPhotoURL: string | null;
  status: PollStatus;
  // Denormalized count of distinct voters (NOT total selections — a voter
  // who picks 3 options counts as 1). Used for "X 人が投票" UI and to
  // gate "options can no longer be edited" once the first vote arrives.
  voterCount: number;
  // Denormalized like count on the poll itself. Missing = 0 on legacy docs.
  likeCount?: number;
  createdAt: TsLike;
  updatedAt: TsLike;
}

// `polls/{pollId}/votes/{uid}` — doc id is the voter uid so a user can
// only have a single ballot per poll. Stores the full set of selected
// option ids; updating the vote is a single doc write + transactional
// per-option count delta.
export interface PollVoteDoc {
  // Mirrors the `id` field on the parent doc for convenience. Doc id ===
  // uid; we don't store it in the body because the path already encodes it.
  optionIds: string[];
  createdAt: TsLike;
  updatedAt: TsLike;
}
