import { parentRoutePrefix } from "@/lib/comments-parent";
import type { NotificationDoc } from "@/lib/types";

type NotificationLinkTarget = Pick<
  NotificationDoc,
  "parentType" | "parentSlug" | "commentId"
>;

export function notificationHref(notification: NotificationLinkTarget): string {
  return `${parentRoutePrefix(notification.parentType)}/${notification.parentSlug}#comment-${notification.commentId}`;
}
