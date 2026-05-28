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
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  affiliation?: string;
  emailOptIn: boolean;
  createdAt: TsLike;
  updatedAt: TsLike;
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
  coverImagePath?: string;
  surveyFields: SurveyField[];
  rsvpCount: number;
  presenterCount: number;
  waitlistCount: number;
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

// ---------- comments + likes (shared across post + guide) ----------
// Comments and likes use parallel subcollections under both `posts/` and
// `guides/`. The shapes are identical; only the parent collection differs.
export type CommentParentType = "post" | "guide";

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
export type GuideStatus = "draft" | "published";

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
  // Denormalized like count. Old docs may not have it; treat missing as 0.
  likeCount?: number;
  createdAt: TsLike;
  updatedAt: TsLike;
  createdBy: GuideAuthorRef;
  updatedBy: GuideAuthorRef;
}
