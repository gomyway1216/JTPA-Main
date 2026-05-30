"use client";

import Link from "@/i18n/navigation";
import { loginHref } from "@/i18n/paths";
import { useLocale, useTranslations } from "next-intl";
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
  const t = useTranslations("FeedbackForm");
  const auth = useTranslations("Auth");
  const locale = useLocale();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!user) {
    return (
      <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm dark:border-zinc-700 dark:bg-zinc-900">
        <p className="mb-2 text-zinc-700 dark:text-zinc-300">
          {t("loginRequired")}
        </p>
        <Link
          href={loginHref("/help#feedback", locale)}
          className="inline-flex rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {auth("googleLogin")}
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
      setError(t("bodyMin", { count: BODY_MIN }));
      return;
    }
    if (trimmed.length > BODY_MAX) {
      setError(t("bodyMax", { count: BODY_MAX }));
      return;
    }
    startTransition(async () => {
      try {
        await submitFeedback({ body: trimmed });
        setBody("");
        setSuccess(t("success"));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("sendFailed"));
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
        {t("label")}
      </label>
      <textarea
        id="feedback-body"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          // Drop the previous send's banner the moment the user starts
          // a fresh message — otherwise the success / error message
          // sits there alongside what's plainly a new draft and reads
          // as if it applies to the in-progress text. Per PR #88
          // Gemini review.
          if (success) setSuccess(null);
          if (error) setError(null);
        }}
        rows={5}
        placeholder={t("placeholder")}
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
          {pending ? t("sending") : t("send")}
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
        {t("privacy")}
      </p>
    </form>
  );
}
