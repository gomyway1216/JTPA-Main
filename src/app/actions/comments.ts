"use server";

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import * as z from "zod";

import { plainify } from "@/lib/data/serialize";
import { requireUser } from "@/lib/auth/session";
import { adminDb } from "@/lib/firebase/admin";
import type {
  CommentDoc,
  CommentParentType,
  GuideDoc,
  PostDoc,
} from "@/lib/types";

// ---------- helpers ----------

function parentCollection(parentType: CommentParentType): string {
  return parentType === "post" ? "posts" : "guides";
}

function parentRoutePrefix(parentType: CommentParentType): string {
  return parentType === "post" ? "/blog" : "/guide";
}

// Both posts and guides are only visible publicly when status is
// "published". Anything else (draft, pending, rejected, archived for posts;
// draft for guides) means comments shouldn't accept new writes. Wrapping
// the check here keeps the per-type literal in one place.
function parentIsPubliclyVisible(
  parentType: CommentParentType,
  data: PostDoc | GuideDoc,
): boolean {
  return data.status === "published";
}

const CommentSchema = z.object({
  parentType: z.enum(["post", "guide"]),
  parentId: z.string().min(1),
  body: z.string().trim().min(1).max(2000),
  // Top-level comment when omitted/null. When provided, must reference
  // an existing comment under the same parent — verified server-side
  // before the write goes through.
  parentCommentId: z.string().min(1).optional().nullable(),
});

const DeleteSchema = z.object({
  parentType: z.enum(["post", "guide"]),
  parentId: z.string().min(1),
  commentId: z.string().min(1),
});

export type CommentInput = z.input<typeof CommentSchema>;
export type DeleteCommentInput = z.input<typeof DeleteSchema>;

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

// ---------- post / list ----------

export async function postComment(input: CommentInput): Promise<CommentDoc> {
  const user = await requireUser();
  const parsed = readableParse(CommentSchema, input);

  // Confirm the parent is published before accepting comments. Firestore
  // rules enforce the same on direct client writes, but Server Actions go
  // through the Admin SDK (which bypasses rules), so we re-check.
  const parentRef = adminDb()
    .collection(parentCollection(parsed.parentType))
    .doc(parsed.parentId);
  const parentSnap = await parentRef.get();
  if (!parentSnap.exists) throw new Error("NOT_FOUND");
  const parentData = parentSnap.data() as PostDoc | GuideDoc;
  if (!parentIsPubliclyVisible(parsed.parentType, parentData)) {
    throw new Error("コメントは公開済みのコンテンツにのみ投稿できます");
  }

  // If this is a reply, validate the parent comment exists AND lives under
  // the same parent. Without this check, a malicious client could submit
  // `parentCommentId` pointing at a comment under a totally different
  // post/guide and our "Re: @author" rendering would silently misattribute.
  if (parsed.parentCommentId) {
    const parentCommentSnap = await parentRef
      .collection("comments")
      .doc(parsed.parentCommentId)
      .get();
    if (!parentCommentSnap.exists) {
      throw new Error("返信先のコメントが見つかりません");
    }
  }

  const now = Timestamp.now();
  const ref = parentRef.collection("comments").doc();
  const doc: Omit<CommentDoc, "id"> = {
    parentType: parsed.parentType,
    parentId: parsed.parentId,
    authorUid: user.uid,
    authorName: user.displayName,
    authorPhotoURL: user.photoURL,
    body: parsed.body,
    parentCommentId: parsed.parentCommentId ?? null,
    likeCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(doc);
  await parentRef.update({ updatedAt: FieldValue.serverTimestamp() });

  // Use the canonical slug from Firestore, not anything the caller sent
  // (slugs in the route are server-validated this way).
  revalidatePath(`${parentRoutePrefix(parsed.parentType)}/${parentData.slug}`);
  return plainify({ ...doc, id: ref.id });
}

// ---------- delete ----------

export async function deleteComment(
  input: DeleteCommentInput,
): Promise<void> {
  const user = await requireUser();
  const parsed = readableParse(DeleteSchema, input);

  const parentRef = adminDb()
    .collection(parentCollection(parsed.parentType))
    .doc(parsed.parentId);
  const ref = parentRef.collection("comments").doc(parsed.commentId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const cur = snap.data() as CommentDoc;
  if (cur.authorUid !== user.uid && !user.isAdmin) {
    throw new Error("FORBIDDEN");
  }

  await ref.delete();
  // Touch parent so cached pages with denormalized counters invalidate,
  // and pick the slug off the parent for the revalidate path (don't
  // trust caller for the route).
  const parentSnap = await parentRef.get();
  await parentRef.update({ updatedAt: FieldValue.serverTimestamp() });
  if (parentSnap.exists) {
    const parentData = parentSnap.data() as PostDoc | GuideDoc;
    revalidatePath(
      `${parentRoutePrefix(parsed.parentType)}/${parentData.slug}`,
    );
  }
}

// ---------- legacy aliases ----------
// Keep the old signature available so any caller that still uses
// `postComment({ postId, body })` keeps working until they migrate.
// Removed once all call sites use the parent-typed API.
export type PostCommentInput = {
  postId: string;
  body: string;
  parentCommentId?: string | null;
};
export async function postPostComment(
  input: PostCommentInput,
): Promise<CommentDoc> {
  return postComment({
    parentType: "post",
    parentId: input.postId,
    body: input.body,
    parentCommentId: input.parentCommentId,
  });
}
