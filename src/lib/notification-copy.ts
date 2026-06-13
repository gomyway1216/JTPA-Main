import type { NotificationDoc } from "@/lib/types";

export type NotificationMessageKey =
  | "commentOnContent"
  | "replyToComment"
  | "likeOnContent"
  | "likeOnComment";

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
    case "comment_on_content":
    default:
      return "commentOnContent";
  }
}
