"use client";

import { signOut as fbSignOut } from "firebase/auth";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { signOut } from "@/app/actions/auth";
import { clientAuth } from "@/lib/firebase/client";

export function SignOutButton({ className }: { className?: string }) {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    await fbSignOut(clientAuth);
    startTransition(async () => {
      await signOut();
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || pending}
      className={
        className ??
        "text-sm text-zinc-700 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-300 dark:hover:text-zinc-100"
      }
    >
      {t("logout")}
    </button>
  );
}
