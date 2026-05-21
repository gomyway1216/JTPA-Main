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
export interface PresentationDoc {
  id: string;
  eventId: string;
  presenterUid: string;
  presenterName: string;
  title: string;
  abstract?: string;
  filePath?: string;
  fileUrl?: string;
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
}
