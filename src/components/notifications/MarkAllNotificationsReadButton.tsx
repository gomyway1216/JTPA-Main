"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { markAllNotificationsRead } from "@/app/actions/notifications";

type MarkAllNotificationsReadButtonProps = {
  children: string;
  pendingLabel?: string;
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
      await markAllNotificationsRead();
      router.refresh();
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
