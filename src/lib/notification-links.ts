import { parentRoutePrefix } from "@/lib/comments-parent";
import type { NotificationDoc } from "@/lib/types";

type NotificationLinkTarget = Pick<
  NotificationDoc,
  "parentType" | "parentSlug" | "commentId"
>;

export function notificationHref(notification: NotificationLinkTarget): string {
  const href = `${parentRoutePrefix(notification.parentType)}/${notification.parentSlug}`;
  return notification.commentId
    ? `${href}#comment-${notification.commentId}`
    : href;
}
