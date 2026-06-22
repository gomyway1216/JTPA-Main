"use client";

import { unstable_rethrow } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  deleteMyPoll,
  submitPoll,
  updateMyPoll,
  type PollFormInput,
} from "@/app/actions/poll";
import { Field } from "@/components/forms/Field";
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  primaryButtonClass,
} from "@/components/forms/styles";
import {
  CONTENT_LOCALES,
  initialContentLocales,
  normalizeContentLocales,
  preferredContentLocale,
  type ContentLocale,
} from "@/lib/content-localization";
import type { LocalizedPollContent, PollDoc } from "@/lib/types";

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

interface DraftOption {
  // Existing options carry their server-assigned id back through edit so
  // the action can preserve the voteCount on those rows. New rows leave
  // it undefined and the action mints a fresh id.
  id?: string;
  labels: Record<ContentLocale, string>;
}

type DraftPollContent = Pick<LocalizedPollContent, "title" | "description">;

function initialPollLocales(poll: PollDoc | undefined): ContentLocale[] {
  if (!poll) return initialContentLocales(undefined);
  const normalized = normalizeContentLocales(poll.locales);
  return normalized.length > 0 ? normalized : [...CONTENT_LOCALES];
}

function emptyPollContent(): DraftPollContent {
  return { title: "", description: "" };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasText(value: unknown): boolean {
  return textValue(value).trim().length > 0;
}

function emptyPollContentByLocale(): Record<ContentLocale, DraftPollContent> {
  return Object.fromEntries(
    CONTENT_LOCALES.map((locale) => [locale, emptyPollContent()]),
  ) as Record<ContentLocale, DraftPollContent>;
}

function emptyLabelsByLocale(): Record<ContentLocale, string> {
  return Object.fromEntries(
    CONTENT_LOCALES.map((locale) => [locale, ""]),
  ) as Record<ContentLocale, string>;
}

function initialPollContentByLocale(
  poll: PollDoc | undefined,
): Record<ContentLocale, DraftPollContent> {
  const next = emptyPollContentByLocale();
  if (!poll) return next;

  let hasLocalized = false;
  for (const locale of CONTENT_LOCALES) {
    const content = poll.localized?.[locale];
    if (!content) continue;
    next[locale] = {
      title: textValue(content.title),
      description: textValue(content.description),
    };
    hasLocalized = true;
  }

  if (!hasLocalized) {
    const fallbackLocale = initialPollLocales(poll)[0] ?? CONTENT_LOCALES[0];
    next[fallbackLocale] = {
      title: poll.title,
      description: poll.description,
    };
  }

  return next;
}

function initialPollOptions(poll: PollDoc | undefined): DraftOption[] {
  if (!poll) {
    return [
      { labels: emptyLabelsByLocale() },
      { labels: emptyLabelsByLocale() },
    ];
  }

  const fallbackLocale = initialPollLocales(poll)[0] ?? CONTENT_LOCALES[0];
  return poll.options.map((option, index) => {
    const labels = emptyLabelsByLocale();
    let hasLocalized = false;
    for (const locale of CONTENT_LOCALES) {
      const localizedOption =
        poll.localized?.[locale]?.options?.find(
          (candidate) => candidate.id === option.id,
        ) ?? poll.localized?.[locale]?.options?.[index];
      if (!localizedOption) continue;
      labels[locale] = textValue(localizedOption.label);
      hasLocalized = true;
    }
    if (!hasLocalized) labels[fallbackLocale] = option.label;
    return { id: option.id, labels };
  });
}

function initialPollActiveLocale(
  poll: PollDoc | undefined,
  currentLocale: string,
): ContentLocale {
  if (!poll) {
    return (
      preferredContentLocale(undefined, currentLocale) ?? CONTENT_LOCALES[0]
    );
  }
  const localizedLocales = CONTENT_LOCALES.filter((locale) => {
    const content = poll.localized?.[locale];
    return Boolean(
      content &&
      (hasText(content.title) ||
        hasText(content.description) ||
        content.options?.some((option) => hasText(option.label))),
    );
  });
  if (localizedLocales.length > 0) {
    return (
      preferredContentLocale(localizedLocales, currentLocale) ??
      localizedLocales[0]
    );
  }
  return initialPollLocales(poll)[0] ?? CONTENT_LOCALES[0];
}

interface Props {
  mode: "create" | "edit";
  poll?: PollDoc;
  // When true, the options list is read-only because at least one voter
  // has already cast a ballot. Mirrors the server-side guard in
  // `updateMyPoll`; surfacing it in the UI lets us disable the controls
  // and explain why instead of silently dropping edits.
  optionsLocked?: boolean;
}

export function PollForm({ mode, poll, optionsLocked }: Props) {
  const locale = useLocale();
  const t = useTranslations("PollForm");
  const [activeLocale, setActiveLocale] = useState<ContentLocale>(
    initialPollActiveLocale(poll, locale),
  );
  const [localizedContent, setLocalizedContent] = useState<
    Record<ContentLocale, DraftPollContent>
  >(initialPollContentByLocale(poll));
  const [options, setOptions] = useState<DraftOption[]>(
    initialPollOptions(poll),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeContent = localizedContent[activeLocale];

  function setOptionLabel(idx: number, label: string) {
    setOptions((cur) =>
      cur.map((o, i) =>
        i === idx
          ? { ...o, labels: { ...o.labels, [activeLocale]: label } }
          : o,
      ),
    );
  }

  function updateActiveContent(patch: Partial<DraftPollContent>) {
    setLocalizedContent((cur) => ({
      ...cur,
      [activeLocale]: { ...cur[activeLocale], ...patch },
    }));
  }

  function addOption() {
    setOptions((cur) =>
      cur.length >= MAX_OPTIONS
        ? cur
        : [...cur, { labels: emptyLabelsByLocale() }],
    );
  }

  function removeOption(idx: number) {
    setOptions((cur) =>
      cur.length <= MIN_OPTIONS ? cur : cur.filter((_, i) => i !== idx),
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const completeLocaleCount = CONTENT_LOCALES.filter(
      (value) =>
        localizedContent[value].title.trim().length >= 2 &&
        options.filter((o) => o.labels[value].trim()).length >= MIN_OPTIONS,
    ).length;
    if (completeLocaleCount === 0) {
      setError(t("minOptionsError", { count: MIN_OPTIONS }));
      return;
    }
    const payload: PollFormInput = {
      localized: Object.fromEntries(
        CONTENT_LOCALES.map((value) => [
          value,
          {
            title: localizedContent[value].title,
            description: localizedContent[value].description,
            options: options.map((option) => ({
              id: option.id,
              label: option.labels[value],
            })),
          },
        ]),
      ) as PollFormInput["localized"],
    };
    startTransition(async () => {
      try {
        const res =
          mode === "create"
            ? await submitPoll(payload)
            : poll
              ? await updateMyPoll(poll.id, payload)
              : null;
        if (res && !res.ok) setError(res.error);
      } catch (err) {
        // submit/update redirect on success (throwing NEXT_REDIRECT); let
        // unstable_rethrow pass that through and surface anything else.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("submitFailed"));
      }
    });
  }

  async function handleDelete() {
    if (!poll) return;
    if (!confirm(t("deleteConfirm"))) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await deleteMyPoll(poll.id);
        if (res && !res.ok) setError(res.error);
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  const canSubmit = CONTENT_LOCALES.some(
    (value) =>
      localizedContent[value].title.trim().length >= 2 &&
      options.filter((o) => o.labels[value].trim()).length >= MIN_OPTIONS,
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-4">
        <div
          role="group"
          aria-label={t("localization")}
          className="flex flex-wrap gap-2"
        >
          {CONTENT_LOCALES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={activeLocale === value}
              disabled={pending}
              onClick={() => setActiveLocale(value)}
              className={`min-h-10 rounded-md border px-3 py-2 text-sm font-medium transition ${
                activeLocale === value
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {t(`locales.${value}`)}
            </button>
          ))}
        </div>

        <Field
          label={t("title")}
          required
          htmlFor={`poll-title-${activeLocale}`}
        >
          <input
            id={`poll-title-${activeLocale}`}
            type="text"
            aria-required="true"
            maxLength={120}
            value={activeContent.title}
            onChange={(e) => updateActiveContent({ title: e.target.value })}
            placeholder={t("titlePlaceholder")}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t("description")} htmlFor={`poll-desc-${activeLocale}`}>
        <textarea
          id={`poll-desc-${activeLocale}`}
          rows={3}
          maxLength={2000}
          value={activeContent.description}
          onChange={(e) => updateActiveContent({ description: e.target.value })}
          placeholder={t("descriptionPlaceholder")}
          className={inputClass}
        />
      </Field>

      <Field
        label={t("options", { min: MIN_OPTIONS, max: MAX_OPTIONS })}
        required
      >
        <div className="space-y-2">
          {optionsLocked && (
            // The form re-renders the option inputs disabled so the
            // user can still see what they originally chose, but any
            // changes are ignored server-side. Explaining the freeze
            // up front avoids silent edits.
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {t("optionsLocked")}
            </p>
          )}
          {options.map((opt, idx) => (
            <div
              key={opt.id ?? `new-${idx}`}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                maxLength={80}
                value={opt.labels[activeLocale]}
                onChange={(e) => setOptionLabel(idx, e.target.value)}
                placeholder={t("optionPlaceholder", { number: idx + 1 })}
                disabled={optionsLocked}
                className={inputClass}
              />
              <button
                type="button"
                onClick={() => removeOption(idx)}
                disabled={
                  optionsLocked || pending || options.length <= MIN_OPTIONS
                }
                className="shrink-0 rounded-md border border-zinc-300 px-2 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                aria-label={t("removeOption", { number: idx + 1 })}
              >
                ✕
              </button>
            </div>
          ))}
          {!optionsLocked && options.length < MAX_OPTIONS && (
            <button
              type="button"
              onClick={addOption}
              disabled={pending}
              className="rounded-md border border-dashed border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              {t("addOption")}
            </button>
          )}
        </div>
      </Field>

      {error && <p className={errorTextClass}>{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || !canSubmit}
          className={primaryButtonClass}
        >
          {pending
            ? t("submitting")
            : mode === "create"
              ? t("submit")
              : t("update")}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className={`ml-auto ${dangerButtonClass}`}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </form>
  );
}
