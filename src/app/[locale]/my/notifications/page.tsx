import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { MarkAllNotificationsReadButton } from "@/components/notifications/MarkAllNotificationsReadButton";
import { NotificationOpenLink } from "@/components/notifications/NotificationOpenLink";
import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import {
  countUnreadNotifications,
  listMyNotifications,
} from "@/lib/data/notifications";
import {
  notificationMessageKey,
  notificationPreview,
} from "@/lib/notification-copy";
import { notificationHref } from "@/lib/notification-links";
import type { NotificationDoc } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("MyNotifications");
  return { title: t("metadataTitle") };
}

export default async function MyNotificationsPage() {
  const user = await getSessionUser();
  if (!user) {
    const locale = await getLocale();
    redirect(loginPath("/my/notifications", locale));
  }

  const [locale, t, notifications, unreadCount] = await Promise.all([
    getLocale(),
    getTranslations("MyNotifications"),
    listMyNotifications(user.uid).catch((err) => {
      console.error("Failed to list notifications:", err);
      return [] as NotificationDoc[];
    }),
    countUnreadNotifications(user.uid).catch((err) => {
      console.error("Failed to count unread notifications:", err);
      return 0;
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
        {unreadCount > 0 && (
          <MarkAllNotificationsReadButton
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("markAllRead")}
          </MarkAllNotificationsReadButton>
        )}
      </header>

      {notifications.length === 0 ? (
        <p className="text-zinc-500">{t("empty")}</p>
      ) : (
        <ul className="space-y-3">
          {notifications.map((n) => {
            const preview = notificationPreview(n);
            return (
              <li
                key={n.id}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-500">
                      {t(`parent.${n.parentType}`)} ·{" "}
                      {formatDateTime(n.createdAt, locale)}
                    </p>
                    <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {t(notificationMessageKey(n), {
                        actorName: n.actorName,
                        title: n.parentTitle,
                      })}
                    </p>
                    {preview && (
                      <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                        {preview}
                      </p>
                    )}
                    <NotificationOpenLink
                      notificationId={n.id}
                      href={notificationHref(n)}
                      className="mt-3 inline-flex text-sm font-medium text-blue-600 hover:underline"
                    >
                      {t("open")}
                    </NotificationOpenLink>
                  </div>
                  {!n.readAt && (
                    <span className="whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                      {t("unread")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
