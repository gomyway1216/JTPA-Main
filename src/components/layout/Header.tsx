"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";

import { markAllNotificationsRead } from "@/app/actions/notifications";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { NotificationOpenLink } from "@/components/notifications/NotificationOpenLink";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import Link, { usePathname } from "@/i18n/navigation";
import { notificationHref } from "@/lib/notification-links";
import type { NotificationDoc, SessionUser } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/events", key: "events" },
  { href: "/showcase", key: "showcase" },
  { href: "/community", key: "community" },
] as const;

type HeaderProps = {
  user: SessionUser | null;
  unreadNotificationCount?: number;
};

type HeaderNotificationsResponse = {
  notifications?: NotificationDoc[];
};

function unreadBadgeLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function Header({
  user,
  unreadNotificationCount = 0,
}: HeaderProps) {
  const t = useTranslations("Header");
  const notificationT = useTranslations("MyNotifications");
  const locale = useLocale();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationDoc[]>([]);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState(false);
  const [localUnreadCount, setLocalUnreadCount] = useState({
    source: unreadNotificationCount,
    count: unreadNotificationCount,
  });
  const [markingAllRead, startMarkingAllRead] = useTransition();
  const userMenuRef = useRef<HTMLDivElement>(null);
  const nextLocale = locale === "ja" ? "en" : "ja";
  const userMenuLabel = user?.displayName || user?.email || t("userMenu");
  const unreadCount =
    localUnreadCount.source === unreadNotificationCount
      ? localUnreadCount.count
      : unreadNotificationCount;
  const userMenuAriaLabel =
    unreadCount > 0
      ? `${userMenuLabel} (${t("notificationsUnread", {
          count: unreadCount,
        })})`
      : userMenuLabel;

  // Close user dropdown on outside click
  useEffect(() => {
    if (!userMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [userMenuOpen]);

  // Escape closes either menu
  useEffect(() => {
    if (!mobileOpen && !userMenuOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMobileOpen(false);
        setUserMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen, userMenuOpen]);

  async function loadNotifications() {
    if (!user || notificationsLoaded || notificationsLoading) return;
    setNotificationsLoading(true);
    setNotificationsError(false);

    try {
      const res = await fetch("/api/my/notifications", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to load notifications: ${res.status}`);
      }
      const data = (await res.json()) as HeaderNotificationsResponse;
      setNotifications(data.notifications ?? []);
    } catch (err) {
      console.error("Failed to load header notifications:", err);
      setNotifications([]);
      setNotificationsError(true);
    } finally {
      setNotificationsLoaded(true);
      setNotificationsLoading(false);
    }
  }

  function toggleUserMenu() {
    if (!userMenuOpen) void loadNotifications();
    setUserMenuOpen((v) => !v);
  }

  function markDropdownNotificationsRead() {
    const previousUnreadCount = unreadCount;
    const previousNotifications = notifications;

    setLocalUnreadCount({ source: unreadNotificationCount, count: 0 });
    setNotifications((current) =>
      current.map((notification) =>
        notification.readAt ? notification : { ...notification, readAt: new Date() },
      ),
    );

    startMarkingAllRead(async () => {
      try {
        await markAllNotificationsRead();
      } catch (err) {
        console.error("Failed to mark notifications read:", err);
        setLocalUnreadCount({
          source: unreadNotificationCount,
          count: previousUnreadCount,
        });
        setNotifications(previousNotifications);
      }
    });
  }

  const avatarFallback = (
    user?.displayName?.charAt(0) ||
    user?.email?.charAt(0) ||
    "?"
  ).toUpperCase();

  return (
    // Frosted-glass sticky header. `position: sticky` keeps the bar
    // pinned through page scroll; `backdrop-blur-xl` + a translucent
    // background blurs the page contents that scroll behind it, the
    // signature Apple-style "vibrancy" effect. The border is intentionally
    // lighter than a normal `border-zinc-200` so the bar reads as one
    // continuous frosted layer rather than a stacked panel.
    //
    // `backdrop-blur` already makes the <header> a stacking context, and
    // pages below us also create their own (e.g. the landing-page hero
    // uses `isolate` for its decorative blobs). `z-30` keeps the header's
    // stacking context above the page area so dropdowns stay clickable
    // even when a page section uses negative-z decorations.
    <header className="sticky top-0 z-30 border-b border-zinc-200/60 bg-white/70 backdrop-blur-xl supports-[backdrop-filter:blur(0)]:bg-white/60 dark:border-zinc-800/60 dark:bg-zinc-950/70 dark:supports-[backdrop-filter:blur(0)]:bg-zinc-950/55 print:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {t("siteName")}
          </Link>
          <nav className="hidden gap-4 text-sm text-zinc-700 sm:flex dark:text-zinc-300">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="hover:text-zinc-950 dark:hover:text-white"
              >
                {t(`nav.${l.key}`)}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <ThemeToggle />
          <Link
            href={pathname}
            locale={nextLocale}
            aria-label={t("language")}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t(`locale.${nextLocale}`)}
          </Link>
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={toggleUserMenu}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label={userMenuAriaLabel}
                className="relative flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {user.photoURL ? (
                  <Image
                    src={user.photoURL}
                    alt=""
                    width={28}
                    height={28}
                    className="h-7 w-7 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium dark:bg-zinc-800">
                    {avatarFallback}
                  </span>
                )}
                <span className="hidden max-w-[10rem] truncate sm:inline">
                  {user.displayName || user.email}
                </span>
                {unreadCount > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-blue-600 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white ring-2 ring-white dark:ring-zinc-950">
                    {unreadBadgeLabel(unreadCount)}
                  </span>
                )}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  className="hidden text-zinc-500 sm:inline"
                >
                  <path
                    d="M3 4.5l3 3 3-3"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </button>
              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 z-20 mt-2 max-w-[calc(100vw-2rem)] w-80 overflow-hidden rounded-md border border-zinc-200 bg-white text-sm shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <div className="border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
                    <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {user.displayName || t("userFallback")}
                    </p>
                    <p className="truncate">{user.email}</p>
                  </div>
                  <div className="border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <Link
                        href="/my/notifications"
                        role="menuitem"
                        onClick={() => setUserMenuOpen(false)}
                        className="min-w-0 flex-1 truncate font-medium hover:underline"
                      >
                        {t("notifications")}
                      </Link>
                      {unreadCount > 0 && (
                        <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                          {t("notificationsUnread", {
                            count: unreadCount,
                          })}
                        </span>
                      )}
                    </div>
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={markDropdownNotificationsRead}
                        disabled={markingAllRead}
                        className="mx-3 mb-2 rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        {markingAllRead
                          ? t("notificationsMarkingRead")
                          : t("notificationsMarkAllRead")}
                      </button>
                    )}
                    {notificationsLoading ? (
                      <p className="px-3 pb-3 pt-1 text-xs text-zinc-500">
                        {t("notificationsLoading")}
                      </p>
                    ) : notificationsError ? (
                      <p className="px-3 pb-3 pt-1 text-xs text-red-600 dark:text-red-400">
                        {t("notificationsLoadFailed")}
                      </p>
                    ) : notifications.length > 0 ? (
                      <div>
                        {notifications.map((notification) => {
                          const isUnread = !notification.readAt;
                          return (
                            <NotificationOpenLink
                              key={notification.id}
                              notificationId={notification.id}
                              href={notificationHref(notification)}
                              role="menuitem"
                              onNavigate={() => setUserMenuOpen(false)}
                              className={`block px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                                isUnread
                                  ? "bg-blue-50/70 dark:bg-blue-950/20"
                                  : ""
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                {isUnread && (
                                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-2 text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                    {notificationT(
                                      notification.reason ===
                                        "reply_to_comment"
                                        ? "replyToComment"
                                        : "commentOnContent",
                                      {
                                        actorName: notification.actorName,
                                        title: notification.parentTitle,
                                      },
                                    )}
                                  </p>
                                  <p className="mt-1 line-clamp-1 text-xs text-zinc-600 dark:text-zinc-400">
                                    {notification.commentPreview}
                                  </p>
                                  <p className="mt-1 text-[11px] text-zinc-500">
                                    {formatDateTime(
                                      notification.createdAt,
                                      locale,
                                    )}
                                  </p>
                                </div>
                              </div>
                            </NotificationOpenLink>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="px-3 pb-3 pt-1 text-xs text-zinc-500">
                        {t("notificationsEmpty")}
                      </p>
                    )}
                  </div>
                  <Link
                    href="/my"
                    role="menuitem"
                    onClick={() => setUserMenuOpen(false)}
                    className="block px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    {t("myPage")}
                  </Link>
                  {user.isAdmin && (
                    <Link
                      href="/admin"
                      role="menuitem"
                      onClick={() => setUserMenuOpen(false)}
                      className="block px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {t("admin")}
                    </Link>
                  )}
                  <div className="border-t border-zinc-100 dark:border-zinc-800">
                    <SignOutButton className="block w-full px-3 py-2 text-left hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {t("login")}
            </Link>
          )}

          <button
            type="button"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
            aria-expanded={mobileOpen}
            className="rounded-md p-2 text-zinc-700 hover:bg-zinc-100 sm:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {mobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M3 6h14M3 10h14M3 14h14"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  fill="none"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="border-t border-zinc-200 bg-white sm:hidden dark:border-zinc-800 dark:bg-zinc-950">
          <nav className="mx-auto flex max-w-6xl flex-col px-4 py-2">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className="py-2 text-sm text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
              >
                {t(`nav.${l.key}`)}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
