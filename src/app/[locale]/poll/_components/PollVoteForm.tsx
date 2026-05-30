"use client";

import Link from "@/i18n/navigation";
import { loginHref } from "@/i18n/paths";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { castPollVote } from "@/app/actions/poll";
import { PollResults } from "@/app/[locale]/poll/_components/PollResults";
import type { PollOption, SessionUser } from "@/lib/types";

interface Props {
  pollId: string;
  pollSlug: string;
  initialOptions: PollOption[];
  initialSelectedIds: string[];
  initialVoterCount: number;
  user: SessionUser | null;
}

// Multi-select ballot UI. Editing mode shows checkboxes; the vote button
// button submits the full selection (Server Action computes the diff).
// Default view (after first render or after a successful submit) shows
// the results bar with a small edit trigger to re-enter the edit mode.
export function PollVoteForm({
  pollId,
  pollSlug,
  initialOptions,
  initialSelectedIds,
  initialVoterCount,
  user,
}: Props) {
  const t = useTranslations("PollVote");
  const auth = useTranslations("Auth");
  const locale = useLocale();
  const [options, setOptions] = useState<PollOption[]>(initialOptions);
  const [selectedIds, setSelectedIds] =
    useState<string[]>(initialSelectedIds);
  const [voterCount, setVoterCount] = useState(initialVoterCount);
  // Everyone — including signed-in users who haven't voted yet — lands
  // on the results view by default. The vote / change-vote button
  // opens the edit form. This keeps the PR's "results visible from
  // page load" guarantee for non-voters too (an earlier version
  // auto-entered edit mode for them and hid the bars until they
  // canceled).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(initialSelectedIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggleDraft(optionId: string) {
    setDraft((cur) =>
      cur.includes(optionId)
        ? cur.filter((id) => id !== optionId)
        : [...cur, optionId],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await castPollVote({
          pollId,
          optionIds: draft,
        });
        setOptions(res.options);
        setSelectedIds(res.optionIds);
        setVoterCount(res.voterCount);
        setEditing(false);
        // Refresh server-rendered siblings (comments count, etc.) — the
        // Server Action revalidates the route but useRouter.refresh()
        // makes the client tree pick up the new RSC payload.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("voteError"));
      }
    });
  }

  const selectedSet = new Set(selectedIds);

  if (!user) {
    return (
      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <PollResults
          options={options}
          selectedIds={new Set()}
          voterCount={voterCount}
        />
        <div className="rounded-md border border-dashed border-zinc-200 p-3 text-center text-sm dark:border-zinc-800">
          <p className="mb-2 text-zinc-700 dark:text-zinc-300">
            {t("loginRequired")}
          </p>
          <Link
            href={loginHref(`/poll/${pollSlug}`, locale)}
            className="inline-flex rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {auth("googleLogin")}
          </Link>
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <PollResults
          options={options}
          selectedIds={selectedSet}
          voterCount={voterCount}
        />
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => {
              setDraft(selectedIds);
              setEditing(true);
              setError(null);
            }}
            disabled={pending}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {selectedIds.length === 0 ? t("vote") : t("changeVote")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <p className="text-xs text-zinc-500">
        {t("hint")}
      </p>
      <ul className="space-y-2">
        {options.map((opt) => {
          const checked = draft.includes(opt.id);
          const inputId = `poll-${pollId}-${opt.id}`;
          return (
            <li key={opt.id}>
              <label
                htmlFor={inputId}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleDraft(opt.id)}
                  disabled={pending}
                  className="h-4 w-4"
                />
                <span className={checked ? "font-semibold" : ""}>
                  {opt.label}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setDraft(selectedIds);
            setEditing(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {t("cancel")}
        </button>
        <div className="flex items-center gap-2">
          {selectedIds.length > 0 && (
            // Lets the user wipe their ballot without un-checking each
            // box one at a time; the Server Action treats an empty
            // array as "un-vote" and deletes the ballot doc.
            <button
              type="button"
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  try {
                    const res = await castPollVote({ pollId, optionIds: [] });
                    setOptions(res.options);
                    setSelectedIds(res.optionIds);
                    setVoterCount(res.voterCount);
                    setDraft([]);
                    setEditing(true);
                    router.refresh();
                  } catch (err) {
                    setError(
                      err instanceof Error
                        ? err.message
                        : t("removeVoteError"),
                    );
                  }
                })
              }
              disabled={pending}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            >
              {t("removeVote")}
            </button>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? t("submitting") : t("vote")}
          </button>
        </div>
      </div>
    </form>
  );
}
