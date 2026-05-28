"use client";

import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";

import { updateMyProfile } from "@/app/actions/users";
import { SaveFlash } from "@/components/forms/SaveFlash";

interface Props {
  initial: {
    affiliation: string;
    emailOptIn: boolean;
  };
}

export function ProfileForm({ initial }: Props) {
  const [affiliation, setAffiliation] = useState(initial.affiliation);
  const [emailOptIn, setEmailOptIn] = useState(initial.emailOptIn);
  const [error, setError] = useState<string | null>(null);
  // Bumped to `Date.now()` when save succeeds — updateMyProfile doesn't
  // redirect, so without this the user gets no confirmation. SaveFlash
  // uses the value as a key to restart its visibility timer.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await updateMyProfile({ affiliation, emailOptIn });
        setSavedAt(Date.now());
      } catch (err) {
        // Server-Action `redirect()` (and `notFound()`) signal navigation
        // by throwing an internal Next.js error — let those propagate;
        // surface anything else as a real save failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "保存に失敗しました");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-zinc-200 bg-white p-5 space-y-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        プロフィール設定
      </h2>

      <div className="block">
        <label
          htmlFor="profile-affiliation"
          className="text-sm font-medium"
        >
          所属 (会社・大学・組織など)
        </label>
        <input
          id="profile-affiliation"
          type="text"
          maxLength={200}
          value={affiliation}
          onChange={(e) => setAffiliation(e.target.value)}
          placeholder="例: Anthropic / UC Berkeley / フリーランス"
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <p className="mt-1 text-xs text-zinc-500">
          イベントRSVPフォームの初期値として使われます。
        </p>
      </div>

      <div className="block">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailOptIn}
            onChange={(e) => setEmailOptIn(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            イベント告知などのメール通知を受け取る
            <span className="mt-0.5 block text-xs text-zinc-500">
              チェックを外すと、JTPA からのお知らせメールが届かなくなります。RSVP した個別イベントの確認メールは引き続き送信されます。
            </span>
          </span>
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        <SaveFlash savedAt={savedAt} />
      </div>
    </form>
  );
}
