"use client";

import type { MouseEvent, ReactNode } from "react";

import { markNotificationRead } from "@/app/actions/notifications";
import Link, { useRouter } from "@/i18n/navigation";

type NotificationOpenLinkProps = {
  notificationId: string;
  href: string;
  children: ReactNode;
  className?: string;
  role?: string;
  onNavigate?: () => void;
};

function shouldHandleInPlace(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.currentTarget.target
  );
}

export function NotificationOpenLink({
  notificationId,
  href,
  children,
  className,
  role,
  onNavigate,
}: NotificationOpenLinkProps) {
  const router = useRouter();

  function markReadBestEffort() {
    void markNotificationRead(notificationId).catch((err) => {
      console.error("Failed to mark notification read:", err);
    });
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!shouldHandleInPlace(event)) {
      markReadBestEffort();
      onNavigate?.();
      return;
    }

    event.preventDefault();
    onNavigate?.();

    markReadBestEffort();
    router.push(href);
  }

  return (
    <Link
      href={href}
      role={role}
      onAuxClick={handleClick}
      onClick={handleClick}
      className={className}
    >
      {children}
    </Link>
  );
}
