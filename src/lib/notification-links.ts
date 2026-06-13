import { parentRoutePrefix } from "@/lib/comments-parent";
import type { NotificationDoc } from "@/lib/types";

type NotificationLinkTarget = Pick<
  NotificationDoc,
  "reason" | "parentType" | "parentSlug" | "commentId"
>;

export function notificationHref(notification: NotificationLinkTarget): string {
  switch (notification.reason) {
    case "project_rejected":
      return "/my/projects";
    case "post_rejected":
      return "/my/posts";
    case "guide_rejected":
      return "/my/guides";
  }

  const href = `${parentRoutePrefix(notification.parentType)}/${notification.parentSlug}`;
  return notification.commentId
    ? `${href}#comment-${notification.commentId}`
    : href;
}
