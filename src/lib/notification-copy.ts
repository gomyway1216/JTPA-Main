import type { NotificationDoc } from "@/lib/types";

export type NotificationMessageKey =
  | "commentOnContent"
  | "replyToComment"
  | "likeOnContent"
  | "likeOnComment"
  | "projectApproved"
  | "projectRejected"
  | "postPublished"
  | "postRejected"
  | "guidePublished"
  | "guideRejected";

export function notificationMessageKey(
  notification: Pick<NotificationDoc, "reason">,
): NotificationMessageKey {
  switch (notification.reason) {
    case "reply_to_comment":
      return "replyToComment";
    case "like_on_content":
      return "likeOnContent";
    case "like_on_comment":
      return "likeOnComment";
    case "project_approved":
      return "projectApproved";
    case "project_rejected":
      return "projectRejected";
    case "post_published":
      return "postPublished";
    case "post_rejected":
      return "postRejected";
    case "guide_published":
      return "guidePublished";
    case "guide_rejected":
      return "guideRejected";
    case "comment_on_content":
    default:
      return "commentOnContent";
  }
}

export function notificationPreview(
  notification: Pick<NotificationDoc, "commentPreview" | "moderationNote">,
): string | null {
  return notification.commentPreview || notification.moderationNote || null;
}
