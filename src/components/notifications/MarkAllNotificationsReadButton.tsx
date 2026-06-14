"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useTransition } from "react";

import { markAllNotificationsRead } from "@/app/actions/notifications";

type MarkAllNotificationsReadButtonProps = {
  children: ReactNode;
  pendingLabel?: ReactNode;
  className?: string;
};

export function MarkAllNotificationsReadButton({
  children,
  pendingLabel,
  className,
}: MarkAllNotificationsReadButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await markAllNotificationsRead();
        router.refresh();
      } catch (err) {
        console.error("Failed to mark all notifications read:", err);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      className={className}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
