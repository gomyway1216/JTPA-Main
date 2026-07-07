"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath, updateTag } from "next/cache";
import * as z from "zod";

import {
  enqueueAdminNewPostNotification,
  enqueueModerationDecisionNotification,
  enqueuePostDecisionNotification,
} from "@/lib/notifications";
import {
  deleteStoragePaths,
  findUniqueSlug,
  parseInput,
} from "@/lib/actions/shared";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import {
  CONTENT_LOCALES,
  DEFAULT_CONTENT_LOCALES,
  normalizeContentLocales,
  type ContentLocale,
} from "@/lib/content-localization";
import { buildAuditLogData, recordAuditLog } from "@/lib/data/audit-logs";
import { POSTS_TAG } from "@/lib/data/cache-tags";
import { adminDb } from "@/lib/firebase/admin";
import { actionError } from "@/lib/i18n/action-errors";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import type {
  LocalizedContentMap,
  LocalizedPostContent,
  PostDoc,
  PostStatus,
  ProjectAsset,
} from "@/lib/types";

const AssetSchema = z.object({
  path: z.string().min(1),
  url: z.string().url(),
});

// Author-facing intents. "draft" and "pending" are the only states an
// author can transition into via the form; admins use the dedicated
// `publishPost` / `decidePost` actions for the rest.
const SubmitIntent = z.enum(["draft", "pending"]);

const PostLocalizedContentInputSchema = z.object({
  title: z.string().max(200).default(""),
  excerpt: z.string().max(300).default(""),
  body: z.string().max(50_000).default(""),
});

const LocalizedPostInputSchema = z.object({
  ja: PostLocalizedContentInputSchema.optional(),
  en: PostLocalizedContentInputSchema.optional(),
}).default({});

function hasAnyPostContent(content: LocalizedPostContent): boolean {
  return Boolean(
    content.title.trim() ||
      content.excerpt.trim() ||
      content.body.trim(),
  );
}

function validatePostContent(
  content: LocalizedPostContent,
  ctx: z.RefinementCtx,
  path: (string | number)[],
): boolean {
  let ok = true;
  if (content.title.trim().length < 2) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "title"],
      message: "Title must be at least 2 characters.",
    });
    ok = false;
  }
  if (!content.excerpt.trim()) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "excerpt"],
      message: "Excerpt is required.",
    });
    ok = false;
  }
  if (!content.body.trim()) {
    ctx.addIssue({
      code: "custom",
      path: [...path, "body"],
      message: "Body is required.",
    });
    ok = false;
  }
  return ok;
}

const PostInputSchema = z.object({
  title: z.string().max(200).optional(),
  excerpt: z.string().max(300).optional(),
  body: z.string().max(50_000).optional(),
  localized: LocalizedPostInputSchema,
  locales: z
    .array(z.enum(CONTENT_LOCALES))
    .min(1)
    .max(CONTENT_LOCALES.length)
    .optional()
    .transform((locales) => (locales ? [...new Set(locales)] : undefined)),
  tags: z.array(z.string().min(1).max(30)).max(8).default([]),
  coverImage: AssetSchema.optional(),
  intent: SubmitIntent.default("pending"),
}).transform((input, ctx) => {
  const localized: LocalizedContentMap<LocalizedPostContent> = {};
  const locales: ContentLocale[] = [];
  let sawContent = false;

  for (const locale of CONTENT_LOCALES) {
    const content = input.localized[locale] ?? {
      title: "",
      excerpt: "",
      body: "",
    };
    if (!hasAnyPostContent(content)) continue;
    sawContent = true;
    if (!validatePostContent(content, ctx, ["localized", locale])) continue;
    localized[locale] = content;
    locales.push(locale);
  }

  const legacyContent = {
    title: input.title ?? "",
    excerpt: input.excerpt ?? "",
    body: input.body ?? "",
  };
  if (locales.length === 0 && hasAnyPostContent(legacyContent)) {
    sawContent = true;
    if (validatePostContent(legacyContent, ctx, [])) {
      const legacyLocale =
        normalizeContentLocales(input.locales)[0] ?? DEFAULT_CONTENT_LOCALES[0];
      localized[legacyLocale] = legacyContent;
      locales.push(legacyLocale);
    }
  }

  if (!sawContent) {
    ctx.addIssue({
      code: "custom",
      path: ["localized"],
      message: "Enter content for at least one language.",
    });
  }

  const primary = localized[locales[0]] ?? {
    title: "",
    excerpt: "",
    body: "",
  };
  return {
    ...input,
    title: primary.title,
    excerpt: primary.excerpt,
    body: primary.body,
    locales,
    localized,
  };
});

export type PostFormInput = z.input<typeof PostInputSchema>;
export type PostReturnTo = "my" | "admin";

// submitPost / updateMyPost redirect on success (so they only ever *return*
// on failure); the remaining actions return { ok: true }. Returning the
// error rather than throwing it is what lets the real message reach the
// user — Next masks thrown Server Action errors as a generic digest in
// production (same reasoning as events.ts / users.ts, per PR #59).
export type PostSaveResult = { ok: true } | { ok: false; error: string };

function orphanPaths(
  prev: ProjectAsset | undefined,
  next: ProjectAsset | undefined,
): string[] {
  if (!prev) return [];
  if (next && next.path === prev.path) return [];
  return [prev.path];
}

function postReturnPath(returnTo: PostReturnTo, isAdmin: boolean): string {
  return returnTo === "admin" && isAdmin ? "/admin/posts" : "/my/posts";
}

// Expire the cross-request data cache entries for /blog and
// /blog/[slug] (see src/lib/data/cached.ts). The collection tag covers
// the per-slug detail entries too (every detail entry carries both
// tags), so one call is enough. `updateTag` (vs
// `revalidateTag(tag, "max")`) blocks the next read until fresh data is
// fetched, so an author who publishes and lands back on /blog sees their
// post immediately. Covers public list caches and per-slug detail entries
// at once. The revalidatePath calls in each action remain for
// client-router refresh semantics.
function expirePostCache() {
  updateTag(POSTS_TAG);
}

// ---------- create ----------

export async function submitPost(
  input: PostFormInput,
): Promise<PostSaveResult> {
  const user = await requireUser();
  const pr = await parseInput(PostInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
  const now = Timestamp.now();
  const slug = await findUniqueSlug("posts", parsed.title, { prefix: "post" });

  // Capture the doc id from `.add()` — admin tooling and future moderation
  // actions look posts up by document id, not by slug, so the notification
  // metadata needs the id (not the slug).
  const ref = await adminDb().collection("posts").add({
    slug,
    title: parsed.title,
    excerpt: parsed.excerpt,
    body: parsed.body,
    locales: parsed.locales,
    localized: parsed.localized,
    coverImage: parsed.coverImage,
    tags: parsed.tags,
    authorUid: user.uid,
    authorName: user.displayName,
    authorPhotoURL: user.photoURL,
    status: parsed.intent as PostStatus,
    reviewerUid: null,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  if (parsed.intent === "pending") {
    await enqueueAdminNewPostNotification({
      postId: ref.id,
      title: parsed.title,
      authorName: user.displayName,
      authorEmail: user.email,
    });
  }

  expirePostCache();
  revalidatePath("/blog");
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
  return redirectToLocalizedPath("/my/posts");
}

// ---------- update (owner) ----------

export async function updateMyPost(
  postId: string,
  input: PostFormInput,
  returnTo: PostReturnTo = "my",
): Promise<PostSaveResult> {
  const user = await requireUser();
  const pr = await parseInput(PostInputSchema, input);
  if (!pr.ok) return pr;
  const parsed = pr.data;
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("postNotFound") };
  const cur = snap.data() as PostDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    return { ok: false, error: await actionError("postEditForbidden") };
  }

  const orphans = orphanPaths(cur.coverImage, parsed.coverImage);

  // Non-admin author edits land in the author's chosen intent (draft or
  // pending). Authoring intent → status:
  //   - "draft"   : save without resubmitting for review
  //   - "pending" : (re)submit for admin review
  // The author can never directly set published/rejected/archived; admins
  // handle those transitions via publishPost (or future moderation
  // actions). Firestore rules enforce the same constraint client-side.
  // Admin edits preserve the current status — admins use publishPost
  // explicitly for state transitions.
  const nextStatus: PostStatus = user.isAdmin
    ? cur.status
    : (parsed.intent as PostStatus);

  await ref.update({
    title: parsed.title,
    excerpt: parsed.excerpt,
    body: parsed.body,
    locales: parsed.locales,
    localized: parsed.localized,
    coverImage: parsed.coverImage ?? FieldValue.delete(),
    tags: parsed.tags,
    status: nextStatus,
    ...(nextStatus === "pending" ? { submittedAt: Timestamp.now() } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });

  if (orphans.length > 0) await deleteStoragePaths(orphans);

  expirePostCache();
  revalidatePath("/blog");
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
  return redirectToLocalizedPath(postReturnPath(returnTo, user.isAdmin));
}

// ---------- delete (admin-only) ----------

export async function deletePost(postId: string): Promise<PostSaveResult> {
  const user = await requireUser();
  if (!user.isAdmin) {
    await recordAuditLog({
      action: "post.delete",
      result: "denied",
      actor: user,
      target: { type: "post", id: postId },
      metadata: { reason: "admin_required" },
    });
    return { ok: false, error: await actionError("postDeleteForbidden") };
  }

  const db = adminDb();
  const ref = db.collection("posts").doc(postId);
  const snap = await ref.get();
  // Already gone — nothing to do, treat as success so the UI navigates away.
  if (!snap.exists) {
    await recordAuditLog({
      action: "post.delete",
      result: "not_found",
      actor: user,
      target: { type: "post", id: postId },
    });
    return { ok: true };
  }
  const cur = snap.data() as PostDoc;

  const paths: string[] = [];
  if (cur.coverImage) paths.push(cur.coverImage.path);

  const batch = db.batch();
  batch.delete(ref);
  batch.set(
    db.collection("auditLogs").doc(),
    buildAuditLogData({
      action: "post.delete",
      result: "success",
      actor: user,
      target: {
        type: "post",
        id: postId,
        slug: cur.slug,
        title: cur.title,
        status: cur.status,
        ownerUid: cur.authorUid,
        ownerName: cur.authorName,
      },
    }),
  );
  await batch.commit();
  if (paths.length > 0) await deleteStoragePaths(paths);

  expirePostCache();
  revalidatePath("/blog");
  // Also revalidate the now-gone detail route so a cached 200 from earlier
  // doesn't keep serving the deleted post.
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
  return { ok: true };
}

// ---------- admin shortcuts ----------

export async function publishPost(postId: string): Promise<PostSaveResult> {
  const admin = await requireAdmin();
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("postNotFound") };
  const cur = snap.data() as PostDoc;

  // Check the timestamp directly so re-publishing a post that was edited
  // back to pending doesn't re-trigger "first publish" handling
  // (publishedAt overwrite + duplicate author notification).
  const isFirstPublish = !cur.publishedAt;
  await ref.update({
    status: "published" as const,
    reviewerUid: admin.uid,
    ...(isFirstPublish ? { publishedAt: Timestamp.now() } : {}),
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Notify author the first time it goes live.
  if (isFirstPublish && cur.authorUid) {
    const ownerSnap = await adminDb()
      .collection("users")
      .doc(cur.authorUid)
      .get();
    const ownerEmail = ownerSnap.exists
      ? (ownerSnap.data()?.email as string)
      : null;
    if (ownerEmail) {
      await enqueuePostDecisionNotification({
        to: ownerEmail,
        title: cur.title,
        decision: "published",
      });
    }
    await enqueueModerationDecisionNotification({
      recipientUid: cur.authorUid,
      reason: "post_published",
      actorUid: admin.uid,
      actorName: admin.displayName,
      actorPhotoURL: admin.photoURL,
      parentType: "post",
      parentId: postId,
      parentTitle: cur.title,
      parentSlug: cur.slug,
      createdAt: Timestamp.now(),
    }).catch((err) => {
      console.warn("Failed to enqueue post decision in-app notification:", err);
    });
  }

  expirePostCache();
  revalidatePath("/blog");
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
  return { ok: true };
}

export async function decidePost(
  postId: string,
  decision: "published" | "rejected",
  note?: string,
): Promise<PostSaveResult> {
  const admin = await requireAdmin();
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("postNotFound") };
  const cur = snap.data() as PostDoc;

  // Same first-publish detection as publishPost — anchored on the actual
  // publishedAt timestamp so re-publish after edit doesn't overwrite it
  // or re-notify.
  const isFirstPublish = decision === "published" && !cur.publishedAt;
  const isRejection = decision === "rejected";
  await ref.update({
    status: decision,
    reviewerUid: admin.uid,
    // The note is documented (and labeled in the UI) as the rejection
    // reason. Clear it on approval so a previous rejection's note doesn't
    // accidentally persist when the same post comes back through review
    // and gets approved.
    reviewNote: isRejection ? (note ?? "") : "",
    ...(isFirstPublish ? { publishedAt: Timestamp.now() } : {}),
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Notify the author on first publish OR any rejection. The note only
  // travels with rejection mails to match the UI placeholder + docs.
  const notifyOnDecision = isRejection || isFirstPublish;
  if (notifyOnDecision && cur.authorUid) {
    const ownerSnap = await adminDb()
      .collection("users")
      .doc(cur.authorUid)
      .get();
    const ownerEmail = ownerSnap.exists
      ? (ownerSnap.data()?.email as string)
      : null;
    if (ownerEmail) {
      await enqueuePostDecisionNotification({
        to: ownerEmail,
        title: cur.title,
        decision,
        note: isRejection ? note : undefined,
      });
    }
    await enqueueModerationDecisionNotification({
      recipientUid: cur.authorUid,
      reason: decision === "published" ? "post_published" : "post_rejected",
      actorUid: admin.uid,
      actorName: admin.displayName,
      actorPhotoURL: admin.photoURL,
      parentType: "post",
      parentId: postId,
      parentTitle: cur.title,
      parentSlug: cur.slug,
      moderationNote: isRejection ? note : undefined,
      createdAt: Timestamp.now(),
    }).catch((err) => {
      console.warn("Failed to enqueue post decision in-app notification:", err);
    });
  }

  expirePostCache();
  revalidatePath("/blog");
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
  return { ok: true };
}

// Not wired into the UI yet — kept ready for the published-list archive
// button (planned follow-up) so older posts can be retired without losing
// the doc (vs deletePost which removes it entirely).
export async function archivePost(postId: string): Promise<PostSaveResult> {
  await requireAdmin();
  const ref = adminDb().collection("posts").doc(postId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: await actionError("postNotFound") };
  const cur = snap.data() as PostDoc;
  await ref.update({
    status: "archived" as const,
    updatedAt: FieldValue.serverTimestamp(),
  });
  expirePostCache();
  revalidatePath("/blog");
  revalidatePath(`/blog/${cur.slug}`);
  revalidatePath("/my/posts");
  revalidatePath("/admin/posts");
  return { ok: true };
}
