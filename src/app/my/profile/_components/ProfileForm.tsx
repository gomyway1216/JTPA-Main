"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  checkUsernameAvailable,
  updateMyProfile,
  type UsernameAvailability,
} from "@/app/actions/users";
import { SaveFlash } from "@/components/forms/SaveFlash";
import {
  normalizeUsername,
  USERNAME_HELP_TEXT,
  usernameErrorMessage,
  validateUsernameFormat,
} from "@/lib/users-shared";

interface Props {
  uid: string;
  initial: {
    username: string;
    fullName: string; // Google-account real name, read-only here
    affiliation: string;
    bio: string;
    affiliationPublic: boolean;
    bioPublic: boolean;
    fullNamePublic: boolean;
    emailOptIn: boolean;
    links: {
      portfolio: string;
      github: string;
      linkedin: string;
      sns: string;
    };
  };
}

// Debounce window for the live availability probe. 400ms feels
// responsive while keeping us from spamming the server on every
// keystroke; the user will pause naturally between typing a candidate
// and reading the verdict.
const USERNAME_CHECK_DEBOUNCE_MS = 400;

export function ProfileForm({ uid, initial }: Props) {
  const [username, setUsername] = useState(initial.username);
  const [affiliation, setAffiliation] = useState(initial.affiliation);
  const [bio, setBio] = useState(initial.bio);
  const [affiliationPublic, setAffiliationPublic] = useState(
    initial.affiliationPublic,
  );
  const [bioPublic, setBioPublic] = useState(initial.bioPublic);
  const [fullNamePublic, setFullNamePublic] = useState(initial.fullNamePublic);
  const [emailOptIn, setEmailOptIn] = useState(initial.emailOptIn);
  const [portfolio, setPortfolio] = useState(initial.links.portfolio);
  const [github, setGithub] = useState(initial.links.github);
  const [linkedin, setLinkedin] = useState(initial.links.linkedin);
  const [sns, setSns] = useState(initial.links.sns);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  // Derived synchronously from the current input — these don't need an
  // effect because they're a pure function of `username` (and the
  // initial handle, which is constant for the form's lifetime).
  //
  // `isCurrentHandle` is intentionally computed BEFORE (and
  // independently of) the format check so a grandfathered handle in a
  // reserved namespace (e.g. someone who claimed `user-foo` before
  // the prefix rule landed in PR #94) doesn't get rejected on every
  // re-render of their own profile. The format error is reported only
  // when the user is actually trying to *change* the handle. Per
  // PR #94 Copilot review.
  const usernameNorm = normalizeUsername(username);
  const isCurrentHandle = usernameNorm === normalizeUsername(initial.username);
  const formatErr = validateUsernameFormat(usernameNorm);

  // Async-only state: the server's verdict tagged with the input it was
  // probed for. Storing the input alongside the verdict means a stale
  // result for a previous candidate is just *ignored* by the derived
  // `availability` below (since `serverProbe.for !== usernameNorm`)
  // rather than requiring a synchronous setState-in-effect to clear it.
  // That keeps the effect body free of sync state mutations — the lint
  // rule (and React's docs) flag those as cascading renders.
  const [serverProbe, setServerProbe] = useState<{
    for: string;
    status: "available" | "taken";
  } | null>(null);

  // Debounced live availability probe. Cancellation guards against
  // stale verdicts; the setState calls only happen inside the
  // setTimeout callback (after the effect body has returned), so the
  // rule against synchronous-in-effect state updates is satisfied.
  useEffect(() => {
    if (formatErr || isCurrentHandle) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const result = await checkUsernameAvailable(usernameNorm);
        if (cancelled) return;
        if (result.status === "available" || result.status === "taken") {
          setServerProbe({ for: usernameNorm, status: result.status });
        }
        // "invalid" / "yours" from the server are already handled
        // synchronously by the derived state — drop them.
      } catch {
        // Network blip — leave serverProbe alone so the derived
        // verdict surfaces as "still probing" until the next attempt.
        // The transaction in updateMyProfile is the authoritative
        // last word regardless.
      }
    }, USERNAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [usernameNorm, formatErr, isCurrentHandle]);

  // Compose verdicts in priority order: client-side invalid > current
  // handle > async result for THIS input > still probing. A stale
  // verdict for a previous candidate falls through the `for` check
  // and shows up as "probing" again, which matches user expectation
  // when they keep editing.
  const probeMatchesCurrent = serverProbe?.for === usernameNorm;
  // Resolution order matters: `isCurrentHandle` wins over `formatErr`
  // so a grandfathered reserved handle (e.g. legacy `user-*`) reads as
  // "yours" instead of "invalid" when the user is keeping it
  // unchanged. The server enforces the same grandfather rule in
  // `updateMyProfile` so the form's optimism here matches what the
  // submit path will accept.
  const availability: UsernameAvailability | null = isCurrentHandle
    ? { status: "yours" }
    : formatErr
      ? { status: "invalid", reason: usernameErrorMessage(formatErr) }
      : probeMatchesCurrent
        ? { status: serverProbe!.status }
        : null;
  const probing = !isCurrentHandle && !formatErr && !probeMatchesCurrent;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await updateMyProfile({
          username,
          affiliation,
          bio,
          affiliationPublic,
          bioPublic,
          fullNamePublic,
          emailOptIn,
          links: { portfolio, github, linkedin, sns },
        });
        if (result.ok) {
          setSavedAt(Date.now());
        } else {
          setError(result.error);
        }
      } catch (err) {
        // Server-Action `redirect()` (and `notFound()`) signal
        // navigation by throwing an internal Next.js error — let those
        // propagate; surface anything else as a real save failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "保存に失敗しました");
      }
    });
  }

  const submitBlocked =
    pending ||
    probing ||
    !availability ||
    availability.status === "taken" ||
    availability.status === "invalid";

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

      {/* Username: unique handle + live availability check */}
      <div className="space-y-2">
        <label
          htmlFor="profile-username"
          className="block text-sm font-medium"
        >
          ユーザーネーム
        </label>
        <div className="flex items-stretch overflow-hidden rounded border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950">
          <span className="flex items-center bg-zinc-50 px-3 text-sm text-zinc-500 dark:bg-zinc-900">
            @
          </span>
          <input
            id="profile-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
            className="w-full px-2 py-2 text-sm focus:outline-none bg-transparent"
          />
        </div>
        <UsernameAvailabilityHint
          probing={probing}
          availability={availability}
        />
        <p className="text-xs text-zinc-500">{USERNAME_HELP_TEXT}</p>
      </div>

      {/* Full name (Google) — display + per-field publish toggle */}
      <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <p className="text-sm font-medium">
          フルネーム (Google アカウント)
        </p>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {initial.fullName || "(未設定)"}
        </p>
        <label className="flex items-start gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input
            type="checkbox"
            checked={fullNamePublic}
            onChange={(e) => setFullNamePublic(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            公開プロフィールページにフルネームを表示する
            <span className="mt-0.5 block text-xs text-zinc-500">
              デフォルトでは非公開です。オンにすると @ユーザーネーム の隣に表示されます。
            </span>
          </span>
        </label>
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

      {/* External links — always public when set. Empty = removed. */}
      <fieldset className="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <legend className="text-sm font-medium">
          リンク
          <span className="ml-2 text-xs font-normal text-zinc-500">
            (設定すると公開ページに表示されます)
          </span>
        </legend>
        <LinkInput
          id="profile-link-portfolio"
          label="ポートフォリオ"
          placeholder="https://your-portfolio.example.com"
          value={portfolio}
          onChange={setPortfolio}
        />
        <LinkInput
          id="profile-link-github"
          label="GitHub"
          placeholder="https://github.com/your-handle"
          value={github}
          onChange={setGithub}
        />
        <LinkInput
          id="profile-link-linkedin"
          label="LinkedIn"
          placeholder="https://www.linkedin.com/in/your-handle"
          value={linkedin}
          onChange={setLinkedin}
        />
        <LinkInput
          id="profile-link-sns"
          label="SNS"
          placeholder="X / Instagram / Threads / Bluesky / Mastodon など"
          value={sns}
          onChange={setSns}
        />
      </fieldset>

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
          disabled={submitBlocked}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        <SaveFlash savedAt={savedAt} />
      </div>
    </form>
  );
}

// ---------- inline subcomponents ----------

function LinkInput({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={id}
        type="url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        maxLength={500}
        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
    </div>
  );
}

function UsernameAvailabilityHint({
  probing,
  availability,
}: {
  probing: boolean;
  availability: UsernameAvailability | null;
}) {
  if (probing) {
    return (
      <p className="text-xs text-zinc-500" aria-live="polite">
        確認中…
      </p>
    );
  }
  if (!availability) return null;
  switch (availability.status) {
    case "available":
      return (
        <p className="text-xs text-emerald-700 dark:text-emerald-400" aria-live="polite">
          ✓ このユーザーネームは使えます
        </p>
      );
    case "yours":
      return (
        <p className="text-xs text-zinc-500" aria-live="polite">
          現在のユーザーネームです
        </p>
      );
    case "taken":
      return (
        <p className="text-xs text-red-600" aria-live="polite">
          このユーザーネームは既に使われています
        </p>
      );
    case "invalid":
      return (
        <p className="text-xs text-red-600" aria-live="polite">
          {availability.reason}
        </p>
      );
  }
}
