"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

const actionClass =
  "inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800";

export function EventActions({
  calendarUrl,
  facebookUrl,
  emailUrl,
  eventUrl,
}: {
  calendarUrl: string | null;
  facebookUrl: string;
  emailUrl: string;
  eventUrl: string;
}) {
  const t = useTranslations("EventDetail");
  const [copied, setCopied] = useState(false);

  async function copyEventLink() {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-labelledby="event-actions-title"
      className="border-y border-zinc-200 py-4 dark:border-zinc-800"
    >
      <h2 id="event-actions-title" className="mb-3 text-sm font-semibold">
        {t("eventActionsTitle")}
      </h2>
      <div className="flex flex-wrap gap-2">
        {calendarUrl && (
          <a
            href={calendarUrl}
            target="_blank"
            rel="noreferrer"
            className={actionClass}
          >
            {t("addToGoogleCalendar")}
          </a>
        )}
        <a
          href={facebookUrl}
          target="_blank"
          rel="noreferrer"
          className={actionClass}
        >
          {t("shareOnFacebook")}
        </a>
        <a href={emailUrl} className={actionClass}>
          {t("shareByEmail")}
        </a>
        <button type="button" onClick={copyEventLink} className={actionClass}>
          {copied ? t("linkCopied") : t("copyEventLink")}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">
        {copied ? t("linkCopied") : ""}
      </p>
    </section>
  );
}
