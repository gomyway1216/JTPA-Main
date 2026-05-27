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
  thumbnailPath?: string;
  screenshots: string[];
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
  createdAt: TsLike;
  updatedAt: TsLike;
  createdBy: GuideAuthorRef;
  updatedBy: GuideAuthorRef;
}
