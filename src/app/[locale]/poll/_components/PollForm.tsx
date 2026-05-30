"use client";

import { unstable_rethrow } from "next/navigation";
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
import type { PollDoc } from "@/lib/types";

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;

interface DraftOption {
  // Existing options carry their server-assigned id back through edit so
  // the action can preserve the voteCount on those rows. New rows leave
  // it undefined and the action mints a fresh id.
  id?: string;
  label: string;
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
  const [title, setTitle] = useState(poll?.title ?? "");
  const [description, setDescription] = useState(poll?.description ?? "");
  const [options, setOptions] = useState<DraftOption[]>(
    poll?.options.map((o) => ({ id: o.id, label: o.label })) ?? [
      { label: "" },
      { label: "" },
    ],
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function setOptionLabel(idx: number, label: string) {
    setOptions((cur) => cur.map((o, i) => (i === idx ? { ...o, label } : o)));
  }

  function addOption() {
    setOptions((cur) =>
      cur.length >= MAX_OPTIONS ? cur : [...cur, { label: "" }],
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
    const cleanedOptions = options
      .map((o) => ({ id: o.id, label: o.label.trim() }))
      .filter((o) => o.label.length > 0);
    if (cleanedOptions.length < MIN_OPTIONS) {
      setError(`選択肢は${MIN_OPTIONS}つ以上必要です`);
      return;
    }
    const payload: PollFormInput = {
      title: title.trim(),
      description: description.trim(),
      options: cleanedOptions,
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
        setError(err instanceof Error ? err.message : "送信に失敗しました");
      }
    });
  }

  async function handleDelete() {
    if (!poll) return;
    if (!confirm("この投票を削除しますか？")) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await deleteMyPoll(poll.id);
        if (res && !res.ok) setError(res.error);
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  const canSubmit =
    title.trim().length >= 2 &&
    options.filter((o) => o.label.trim()).length >= MIN_OPTIONS;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="タイトル" required htmlFor="poll-title">
        <input
          id="poll-title"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: 普段どのAIを一番使ってる？"
          className={inputClass}
        />
      </Field>

      <Field label="説明 (任意)" htmlFor="poll-desc">
        <textarea
          id="poll-desc"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="補足や「その他はコメントで」などの注記"
          className={inputClass}
        />
      </Field>

      <Field label={`選択肢 (${MIN_OPTIONS}〜${MAX_OPTIONS}つ)`} required>
        <div className="space-y-2">
          {optionsLocked && (
            // The form re-renders the option inputs disabled so the
            // user can still see what they originally chose, but any
            // changes are ignored server-side. Explaining the freeze
            // up front avoids silent edits.
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              既に投票が入っているため、選択肢は変更できません。タイトル・説明のみ編集可能です。
            </p>
          )}
          {options.map((opt, idx) => (
            <div key={opt.id ?? `new-${idx}`} className="flex items-center gap-2">
              <input
                type="text"
                maxLength={80}
                value={opt.label}
                onChange={(e) => setOptionLabel(idx, e.target.value)}
                placeholder={`選択肢 ${idx + 1}`}
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
                aria-label={`選択肢 ${idx + 1} を削除`}
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
              + 選択肢を追加
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
          {pending ? "送信中…" : mode === "create" ? "投稿する" : "更新する"}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className={`ml-auto ${dangerButtonClass}`}
          >
            削除
          </button>
        )}
      </div>
    </form>
  );
}

