"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  addMailingListSubscriber,
  removeMailingListSubscriber,
} from "@/app/actions/mailing-list";
import type { MailingListSubscriber } from "@/lib/types";
import { formatDateTime, toDate } from "@/lib/utils";

function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildCsv(subscribers: MailingListSubscriber[]): string {
  const rows = subscribers.map((subscriber) =>
    [
      subscriber.email,
      subscriber.locale,
      subscriber.source,
      toDate(subscriber.subscribedAt)?.toISOString() ?? "",
    ]
      .map(csvEscape)
      .join(","),
  );
  return "﻿" + ["email,locale,source,subscribedAt", ...rows].join("\n");
}

export function MailingListManager({
  subscribers,
}: {
  subscribers: MailingListSubscriber[];
}) {
  const t = useTranslations("Admin.mailingList");
  const common = useTranslations("Admin.common");
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [email, setEmail] = useState("");
  const [subscriberLocale, setSubscriberLocale] = useState<"ja" | "en">("ja");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visibleSubscribers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? subscribers.filter((subscriber) =>
          subscriber.email.toLowerCase().includes(normalized),
        )
      : subscribers;
  }, [query, subscribers]);

  function flashMessage(value: string) {
    setMessage(value);
    setTimeout(() => setMessage((current) => (current === value ? null : current)), 2500);
  }

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await addMailingListSubscriber({
          email,
          locale: subscriberLocale,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setEmail("");
        flashMessage(t("added"));
        router.refresh();
      } catch (err) {
        console.error("Failed to add mailing list subscriber:", err);
        setError(t("saveFailed"));
      }
    });
  }

  function handleRemove(subscriber: MailingListSubscriber) {
    if (!confirm(t("deleteConfirm", { email: subscriber.email }))) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await removeMailingListSubscriber({
          subscriberId: subscriber.id,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        flashMessage(t("deleted"));
        router.refresh();
      } catch (err) {
        console.error("Failed to remove mailing list subscriber:", err);
        setError(t("deleteFailed"));
      }
    });
  }

  async function copyEmails() {
    if (subscribers.length === 0) {
      flashMessage(common("noRecipients"));
      return;
    }
    try {
      await navigator.clipboard.writeText(
        subscribers.map((subscriber) => subscriber.email).join(", "),
      );
      flashMessage(common("copiedEmails", { count: subscribers.length }));
    } catch {
      flashMessage(common("copyFailed"));
    }
  }

  function downloadCsv() {
    if (subscribers.length === 0) {
      flashMessage(common("noRecipients"));
      return;
    }
    const blob = new Blob([buildCsv(subscribers)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `jtpa-mailing-list-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <form
        onSubmit={handleAdd}
        className="flex flex-col gap-2 border-y border-zinc-200 py-4 sm:flex-row sm:items-end dark:border-zinc-800"
      >
        <label className="flex-1 text-sm font-medium">
          {t("addEmail")}
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("emailPlaceholder")}
            className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <label className="text-sm font-medium">
          {t("language")}
          <select
            value={subscriberLocale}
            onChange={(event) =>
              setSubscriberLocale(event.target.value === "en" ? "en" : "ja")
            }
            className="mt-1 block rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? common("saving") : t("add")}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchAria")}
          className="min-w-64 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <button
          type="button"
          onClick={copyEmails}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {common("copyEmails")}
        </button>
        <button
          type="button"
          onClick={downloadCsv}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {common("downloadCsv")}
        </button>
      </div>

      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <p className="text-xs text-zinc-500">
        {t("visibleCount", {
          visible: visibleSubscribers.length,
          total: subscribers.length,
        })}
      </p>

      {visibleSubscribers.length === 0 ? (
        <p className="py-8 text-center text-sm text-zinc-500">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-zinc-500">
              <tr>
                <th className="py-2 pr-4">{t("columns.email")}</th>
                <th className="py-2 pr-4">{t("columns.language")}</th>
                <th className="py-2 pr-4">{t("columns.source")}</th>
                <th className="py-2 pr-4">{t("columns.subscribedAt")}</th>
                <th className="py-2 text-right">{t("columns.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {visibleSubscribers.map((subscriber) => (
                <tr key={subscriber.id}>
                  <td className="py-3 pr-4 font-medium">{subscriber.email}</td>
                  <td className="py-3 pr-4">{subscriber.locale}</td>
                  <td className="py-3 pr-4">{t(`source.${subscriber.source}`)}</td>
                  <td className="py-3 pr-4 text-zinc-500">
                    {formatDateTime(subscriber.subscribedAt, locale)}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => handleRemove(subscriber)}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      {common("delete")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="border-t border-zinc-200 pt-4 text-xs leading-5 text-zinc-500 dark:border-zinc-800">
        {t("deliveryNote")}
      </p>
    </div>
  );
}
