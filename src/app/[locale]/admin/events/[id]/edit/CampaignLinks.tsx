"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import type { EventPromotionLinks } from "@/lib/event-links";

const CHANNELS = ["facebook", "jtpa", "mailingList"] as const;

export function CampaignLinks({ links }: { links: EventPromotionLinks }) {
  const t = useTranslations("Admin.events.promotionLinks");
  const [copied, setCopied] = useState<(typeof CHANNELS)[number] | null>(null);

  async function copy(channel: (typeof CHANNELS)[number]) {
    try {
      await navigator.clipboard.writeText(links[channel]);
      setCopied(channel);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section className="border-y border-zinc-200 py-4 dark:border-zinc-800">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {t("description")}
      </p>
      <div className="mt-4 space-y-3">
        {CHANNELS.map((channel) => (
          <div
            key={channel}
            className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-center"
          >
            <label
              htmlFor={`campaign-${channel}`}
              className="text-sm font-medium"
            >
              {t(channel)}
            </label>
            <input
              id={`campaign-${channel}`}
              value={links[channel]}
              readOnly
              className="min-w-0 rounded border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => copy(channel)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:bg-zinc-800"
            >
              {copied === channel ? t("copied") : t("copy")}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
