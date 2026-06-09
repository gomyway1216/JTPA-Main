"use client";

import Link from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { selfCheckIn } from "@/app/actions/check-in";

interface Props {
  eventId: string;
  eventSlug: string;
  token: string;
  loginHref: string;
  signedInUser:
    | { uid: string; displayName: string; email: string }
    | null;
  alreadyCheckedIn: boolean;
}

type View = "idle" | "done";

export function CheckInClient({
  eventId,
  eventSlug,
  token,
  loginHref,
  signedInUser,
  alreadyCheckedIn,
}: Props) {
  const t = useTranslations("CheckIn");
  const [view, setView] = useState<View>(alreadyCheckedIn ? "done" : "idle");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSelfCheckIn() {
    setError(null);
    setPending(true);
    try {
      await selfCheckIn(eventId, token);
      setView("done");
    } catch (e) {
      setError(prettyError(e, t));
    } finally {
      setPending(false);
    }
  }

  if (view === "done") {
    return (
      <div className="space-y-4 rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <div className="text-3xl">✓</div>
        <p className="text-lg font-medium text-emerald-900 dark:text-emerald-100">
          {t("doneTitle")}
        </p>
        <p className="text-sm text-emerald-800 dark:text-emerald-200">
          {t("doneDescription")}
        </p>
        <Link
          href={`/events/${eventSlug}`}
          className="inline-block text-sm text-emerald-900 underline hover:no-underline dark:text-emerald-100"
        >
          {t("eventPage")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {signedInUser ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center space-y-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("signedInAs", {
              name: signedInUser.displayName || signedInUser.email,
            })}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={doSelfCheckIn}
            className="w-full rounded-md bg-zinc-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? t("processing") : t("checkIn")}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center space-y-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("loginRequired")}
          </p>
          <Link
            href={loginHref}
            className="block w-full rounded-md bg-zinc-900 px-4 py-3 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t("loginCta")}
          </Link>
          <p className="text-center text-xs text-zinc-500">
            {t("loginReturnHint")}
          </p>
        </div>
      )}
    </div>
  );
}

function prettyError(
  e: unknown,
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Map server-action error codes to friendly Japanese messages. Anything
  // we don't recognize falls through with the raw message — better than
  // silently swallowing genuine problems.
  switch (msg) {
    case "INVALID_TOKEN":
    case "TOKEN_NOT_SET":
      return t("errors.invalidToken");
    case "TOO_EARLY":
      return t("errors.tooEarly");
    case "TOO_LATE":
      return t("errors.tooLate");
    case "EVENT_CANCELLED":
      return t("errors.eventCancelled");
    case "EVENT_NOT_FOUND":
      return t("errors.eventNotFound");
    case "UNAUTHENTICATED":
    case "FORBIDDEN":
      return t("errors.auth");
    default:
      return t("errors.unknown", { message: msg });
  }
}
