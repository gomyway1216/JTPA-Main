"use client";

import { signInWithPopup } from "firebase/auth";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { signInWithIdToken } from "@/app/actions/auth";
import { clientAuth, googleProvider } from "@/lib/firebase/client";

export function SignInButton({
  redirectTo = "/",
  className,
  label,
}: {
  redirectTo?: string;
  className?: string;
  label?: string;
}) {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const cred = await signInWithPopup(clientAuth, googleProvider);
      const idToken = await cred.user.getIdToken();
      await signInWithIdToken(idToken);
      router.replace(redirectTo);
      router.refresh();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : t("loginFailed"));
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleClick}
        className={
          className ??
          "inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
        }
      >
        <GoogleMark />
        {pending ? t("loggingIn") : (label ?? t("googleLogin"))}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35.5 24 35.5c-6.4 0-11.5-5.1-11.5-11.5S17.6 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.7 6.5 29.1 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5c10.8 0 19.5-8.7 19.5-19.5 0-1.3-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12.5 24 12.5c2.9 0 5.6 1.1 7.6 2.9l5.7-5.7C33.7 6.5 29.1 4.5 24 4.5 16.3 4.5 9.6 8.8 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 43.5c5 0 9.6-1.9 13.1-5l-6-5.2c-2 1.4-4.4 2.2-7.1 2.2-5.3 0-9.7-3.1-11.3-7.5L6 32.6C9.3 38.6 16.1 43.5 24 43.5z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.2 5.3l6 5.2c4-3.7 6.4-9.1 6.4-15.5 0-1.3-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
