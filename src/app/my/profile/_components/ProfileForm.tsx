"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useState, useTransition } from "react";

import { updateMyProfile } from "@/app/actions/users";
import { SaveFlash } from "@/components/forms/SaveFlash";

interface Props {
  uid: string;
  initial: {
    affiliation: string;
    bio: string;
    affiliationPublic: boolean;
    bioPublic: boolean;
    emailOptIn: boolean;
  };
}

export function ProfileForm({ uid, initial }: Props) {
  const [affiliation, setAffiliation] = useState(initial.affiliation);
  const [bio, setBio] = useState(initial.bio);
  const [affiliationPublic, setAffiliationPublic] = useState(
    initial.affiliationPublic,
  );
  const [bioPublic, setBioPublic] = useState(initial.bioPublic);
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
        await updateMyProfile({
          affiliation,
          bio,
          affiliationPublic,
          bioPublic,
          emailOptIn,
        });
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
      className="rounded-lg border border-zinc-200 bg-white p-5 space-y-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          プロフィール設定
        </h2>
        <Link
          href={`/u/${uid}`}
          className="text-xs text-blue-600 hover:underline"
        >
          公開ページを見る →
        </Link>
      </div>

      {/* Affiliation: text + per-field publish toggle */}
      <div className="space-y-2">
        <label
          htmlFor="profile-affiliation"
          className="block text-sm font-medium"
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
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={affiliationPublic}
            onChange={(e) => setAffiliationPublic(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            公開プロフィールページに所属を表示する
            <span className="mt-0.5 block text-xs text-zinc-500">
              オフでも、イベントRSVPフォームの初期値としては引き続き使われます。
            </span>
          </span>
        </label>
      </div>

      {/* Bio: textarea + per-field publish toggle */}
      <div className="space-y-2">
        <label htmlFor="profile-bio" className="block text-sm font-medium">
          紹介文
        </label>
        <textarea
          id="profile-bio"
          rows={5}
          maxLength={1000}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="どんなことをしている人か、興味のあるトピックなど。改行できます。"
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input
              type="checkbox"
              checked={bioPublic}
              onChange={(e) => setBioPublic(e.target.checked)}
              className="mt-0.5"
            />
            <span>公開プロフィールページに紹介文を表示する</span>
          </label>
          <span className="text-xs text-zinc-500">{bio.length} / 1000</span>
        </div>
      </div>

      {/* Notifications */}
      <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <p className="text-sm font-medium">通知設定</p>
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
