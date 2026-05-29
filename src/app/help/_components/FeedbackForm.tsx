"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { submitFeedback } from "@/app/actions/feedback";
import type { SessionUser } from "@/lib/types";

interface Props {
  user: SessionUser | null;
}

const BODY_MIN = 4;
const BODY_MAX = 2000;

// Inline feedback form at the bottom of /help. Login-gated: signed-out
// visitors see a CTA pointing at the login redirect that returns them to
// /help (so they don't lose their place after auth). Signed-in users
// get a textarea + a small char counter that turns rose past the cap.
//
// On submit the textarea is cleared and a confirmation message stays
// pinned for a few seconds — keeping the form rendered (rather than
// swapping to a thank-you box) lets a single user send multiple pieces
// without an extra navigation, which matches how this tends to be used
// during a triage push.
export function FeedbackForm({ user }: Props) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!user) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="mb-2 text-zinc-700 dark:text-zinc-300">
          要望や不具合報告を送るにはログインが必要です。
        </p>
        <Link
          href={`/login?redirect=${encodeURIComponent("/help#feedback")}`}
          className="inline-flex rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          Googleでログイン
        </Link>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const trimmed = body.trim();
    if (trimmed.length < BODY_MIN) {
      setError(`本文は${BODY_MIN}文字以上で入力してください。`);
      return;
    }
    if (trimmed.length > BODY_MAX) {
      setError(`本文は${BODY_MAX}文字以内で入力してください。`);
      return;
    }
    startTransition(async () => {
      try {
        await submitFeedback({ body: trimmed });
        setBody("");
        setSuccess(
          "送信しました。確認次第対応します。ありがとうございます！",
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "送信に失敗しました");
      }
    });
  }

  const overCap = body.length > BODY_MAX;
  const counterCls = overCap
    ? "text-rose-600 dark:text-rose-400"
    : "text-zinc-500";

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label
        htmlFor="feedback-body"
        className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
      >
        要望・不具合・改善案
      </label>
      <textarea
        id="feedback-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="例: ガイドの並び順を作者名でフィルタしたい / ◯◯ページでスクロールがガタつく"
        disabled={pending}
        className="w-full rounded-md border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="flex items-center justify-between text-xs">
        <p className={counterCls}>
          {body.length} / {BODY_MAX}
        </p>
        <button
          type="submit"
          disabled={pending || overCap || body.trim().length < BODY_MIN}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "送信中…" : "送信"}
        </button>
      </div>
      {error && (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p
          className="text-sm text-emerald-700 dark:text-emerald-300"
          role="status"
        >
          {success}
        </p>
      )}
      <p className="text-xs text-zinc-500">
        送信内容は admin / editor 権限のメンバーに公開されます。
        メールアドレスは社外には共有しません。
      </p>
    </form>
  );
}
