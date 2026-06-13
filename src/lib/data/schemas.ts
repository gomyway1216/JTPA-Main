import "server-only";

import * as z from "zod";

// Lenient runtime mirrors of the Firestore doc shapes in src/lib/types.ts,
// consumed by `fromSnap` (src/lib/data/from-snap.ts) at the read boundary.
// Validation is warn-only, so these schemas are deliberately permissive:
//
//   - `z.looseObject` everywhere — unknown keys pass through untouched, so
//     a doc written by newer code never trips a warning on older readers.
//   - Every field is optional — docs accrete fields over time (`likeCount`
//     backfills, the users visibility-flags migration, `username`
//     bootstrap, …), so a missing field is normal; only a *wrongly typed*
//     value should warn.
//   - Timestamp fields are `z.any()` — pre-serialization they're Admin SDK
//     `Timestamp` class instances, while tests and JSON round-trips produce
//     `{seconds,nanoseconds}` / `{_seconds,_nanoseconds}` / `Date` shapes.
//     `plainify` + `toDate()` already cope with all of them; validating
//     deeper would add noise, not safety. The explicit `.optional()` is
//     what makes the KEY optional in zod v4 (a bare `z.any()` field still
//     requires the key to be present).
const TsLikeSchema = z.any().optional();

// {path, url} Storage pointer shared by project thumbnails/screenshots,
// post/event cover images, and user avatars (ProjectAsset in types.ts).
const ProjectAssetSchema = z.looseObject({
  path: z.string().optional(),
  url: z.string().optional(),
});

// ---------- users ----------
const UserLinksSchema = z.looseObject({
  portfolio: z.string().optional(),
  github: z.string().optional(),
  linkedin: z.string().optional(),
  sns: z.string().optional(),
});

export const UserProfileSchema = z.looseObject({
  uid: z.string().optional(),
  email: z.string().optional(),
  displayName: z.string().optional(),
  // `photoURL` is typed `string | undefined` but signInWithIdToken writes
  // `decoded.picture ?? null`, so null is a perfectly normal stored value.
  photoURL: z.string().nullable().optional(),
  avatar: ProjectAssetSchema.optional(),
  username: z.string().optional(),
  affiliation: z.string().optional(),
  bio: z.string().optional(),
  affiliationPublic: z.boolean().optional(),
  bioPublic: z.boolean().optional(),
  fullNamePublic: z.boolean().optional(),
  links: UserLinksSchema.optional(),
  emailOptIn: z.boolean().optional(),
  roleBadge: z.enum(["admin", "editor", "contributor"]).optional(),
  eventAttendanceCount: z.number().optional(),
  createdAt: TsLikeSchema,
  updatedAt: TsLikeSchema,
});

// ---------- events ----------
const SurveyFieldSchema = z.looseObject({
  key: z.string().optional(),
  label: z.string().optional(),
  type: z.enum(["text", "textarea", "select", "checkbox"]).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  audience: z.enum(["all", "presenter"]).optional(),
});

export const EventDocSchema = z.looseObject({
  slug: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  startAt: TsLikeSchema,
  endAt: TsLikeSchema,
  location: z
    .looseObject({
      type: z.enum(["online", "offline", "hybrid"]).optional(),
      address: z.string().optional(),
      mapUrl: z.string().optional(),
      meetingUrl: z.string().optional(),
    })
    .optional(),
  capacity: z.number().optional(),
  presenterCapacity: z.number().optional(),
  status: z.enum(["draft", "published", "past", "cancelled"]).optional(),
  visibility: z.enum(["public", "members_only"]).optional(),
  coverImage: ProjectAssetSchema.optional(),
  subImages: z.array(ProjectAssetSchema).optional(),
  surveyFields: z.array(SurveyFieldSchema).optional(),
  rsvpCount: z.number().optional(),
  presenterCount: z.number().optional(),
  waitlistCount: z.number().optional(),
  checkInToken: z.string().optional(),
  checkInEarlyMinutes: z.number().optional(),
  checkInLateMinutes: z.number().optional(),
  attendanceCount: z.number().optional(),
  createdBy: z.string().optional(),
  createdAt: TsLikeSchema,
  updatedAt: TsLikeSchema,
});

// ---------- projects (Showcase) ----------
export const ProjectDocSchema = z.looseObject({
  slug: z.string().optional(),
  ownerUid: z.string().optional(),
  ownerName: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  appUrl: z.string().optional(),
  repoUrl: z.string().optional(),
  demoVideoUrl: z.string().optional(),
  thumbnail: ProjectAssetSchema.optional(),
  screenshots: z.array(ProjectAssetSchema).optional(),
  status: z.enum(["pending", "approved", "rejected", "archived"]).optional(),
  reviewerUid: z.string().nullable().optional(),
  reviewNote: z.string().optional(),
  likeCount: z.number().optional(),
  submittedAt: TsLikeSchema,
  reviewedAt: TsLikeSchema,
  createdAt: TsLikeSchema,
  updatedAt: TsLikeSchema,
});

// ---------- blog posts ----------
export const PostDocSchema = z.looseObject({
  slug: z.string().optional(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
  body: z.string().optional(),
  coverImage: ProjectAssetSchema.optional(),
  tags: z.array(z.string()).optional(),
  authorUid: z.string().optional(),
  authorName: z.string().optional(),
  authorPhotoURL: z.string().nullable().optional(),
  status: z
    .enum(["draft", "pending", "published", "rejected", "archived"])
    .optional(),
  reviewerUid: z.string().nullable().optional(),
  reviewNote: z.string().optional(),
  publishedAt: TsLikeSchema,
  submittedAt: TsLikeSchema,
  reviewedAt: TsLikeSchema,
  likeCount: z.number().optional(),
  createdAt: TsLikeSchema,
  updatedAt: TsLikeSchema,
});

// ---------- guides ----------
const GuideAuthorRefSchema = z.looseObject({
  uid: z.string().optional(),
  displayName: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

export const GuideDocSchema = z.looseObject({
  slug: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z
    .enum(["draft", "pending", "published", "rejected", "archived"])
    .optional(),
  order: z.number().optional(),
  authorUid: z.string().optional(),
  authorName: z.string().optional(),
  authorPhotoURL: z.string().nullable().optional(),
  reviewerUid: z.string().nullable().optional(),
  reviewNote: z.string().optional(),
  publishedAt: TsLikeSchema,
  submittedAt: TsLikeSchema,
  reviewedAt: TsLikeSchema,
  likeCount: z.number().optional(),
  createdAt: TsLikeSchema,
  updatedAt: TsLikeSchema,
  createdBy: GuideAuthorRefSchema.optional(),
  updatedBy: GuideAuthorRefSchema.optional(),
});

// ---------- Q&A ----------
export const QaDocSchema = z.looseObject({
  slug: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  authorUid: z.string().optional(),
  authorName: z.string().optional(),
  authorPhotoURL: z.string().nullable().optional(),
  status: z.enum(["published", "archived"]).optional(),
  likeCount: z.number().optional(),
  createdAt: TsLikeSchema,
  updatedAt: TsLikeSchema,
});

// ---------- polls ----------
const PollOptionSchema = z.looseObject({
  id: z.string().optional(),
  label: z.string().optional(),
  voteCount: z.number().optional(),
});

export const PollDocSchema = z.looseObject({
  slug: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  options: z.array(PollOptionSchema).optional(),
  authorUid: z.string().optional(),
  authorName: z.string().optional(),
  authorPhotoURL: z.string().nullable().optional(),
  status: z.enum(["published", "archived"]).optional(),
  voterCount: z.number().optional(),
  likeCount: z.number().optional(),
  createdAt: TsLikeSchema,
  updatedAt: TsLikeSchema,
});

export const PollVoteDocSchema = z.looseObject({
  optionIds: z.array(z.string()).optional(),
  createdAt: TsLikeSchema,
  updatedAt: TsLikeSchema,
});

// ---------- notifications ----------
export const NotificationDocSchema = z.looseObject({
  recipientUid: z.string().optional(),
  type: z.enum(["comment", "like"]).optional(),
  reason: z
    .enum([
      "comment_on_content",
      "reply_to_comment",
      "like_on_content",
      "like_on_comment",
    ])
    .optional(),
  actorUid: z.string().optional(),
  actorName: z.string().optional(),
  actorPhotoURL: z.string().nullable().optional(),
  parentType: z
    .enum(["post", "guide", "qa", "project", "poll"])
    .optional(),
  parentId: z.string().optional(),
  parentTitle: z.string().optional(),
  parentSlug: z.string().optional(),
  commentId: z.string().optional(),
  parentCommentId: z.string().nullable().optional(),
  commentPreview: z.string().optional(),
  readAt: TsLikeSchema.nullable().optional(),
  createdAt: TsLikeSchema,
});
