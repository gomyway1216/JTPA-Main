"use client";

import { signInAnonymously, signInWithPopup } from "firebase/auth";
import { useState } from "react";

import { signInWithIdToken } from "@/app/actions/auth";
import { guestCheckIn, selfCheckIn } from "@/app/actions/check-in";
import { clientAuth, googleProvider } from "@/lib/firebase/client";

interface Props {
  eventId: string;
  eventSlug: string;
  token: string;
  signedInUser:
    | { uid: string; displayName: string; email: string }
    | null;
  alreadyCheckedIn: boolean;
}

// `view` controls which UI block is on screen; `pending` is orthogonal so
// the in-flight spinner doesn't unmount the form mid-submit (which would
// drop focus and the visible inputs).
type View = "idle" | "guest_form" | "done";

export function CheckInClient({
  eventId,
  eventSlug,
  token,
  signedInUser,
  alreadyCheckedIn,
}: Props) {
  const [view, setView] = useState<View>(alreadyCheckedIn ? "done" : "idle");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [wasGuest, setWasGuest] = useState(false);

  async function doSelfCheckIn() {
    setError(null);
    setPending(true);
    try {
      await selfCheckIn(eventId, token);
      setView("done");
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setPending(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    setPending(true);
    try {
      const cred = await signInWithPopup(clientAuth, googleProvider);
      const idToken = await cred.user.getIdToken();
      await signInWithIdToken(idToken);
      // Now signed in — run the check-in immediately so the user only
      // sees one transition.
      await selfCheckIn(eventId, token);
      setView("done");
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setPending(false);
    }
  }

  async function handleGuestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const cred = await signInAnonymously(clientAuth);
      const idToken = await cred.user.getIdToken();
      await guestCheckIn({
        eventId,
        token,
        idToken,
        name: name.trim(),
        email: email.trim(),
      });
      setWasGuest(true);
      setView("done");
    } catch (e) {
      setError(prettyError(e));
    } finally {
      setPending(false);
    }
  }

  if (view === "done") {
    return (
      <div className="space-y-4 rounded-lg border border-emerald-300 bg-emerald-50 p-6 text-center dark:border-emerald-800 dark:bg-emerald-950">
        <div className="text-3xl">✓</div>
        <p className="text-lg font-medium text-emerald-900 dark:text-emerald-100">
          チェックイン完了
        </p>
        <p className="text-sm text-emerald-800 dark:text-emerald-200">
          ご参加ありがとうございます。
        </p>
        {wasGuest && (
          <p className="text-xs text-emerald-700 dark:text-emerald-300">
            次回からはGoogleでログインすると、過去の参加履歴が引き継がれます。
          </p>
        )}
        <a
          href={`/events/${eventSlug}`}
          className="inline-block text-sm text-emerald-900 underline hover:no-underline dark:text-emerald-100"
        >
          イベントページへ
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {signedInUser ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center space-y-3 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {signedInUser.displayName || signedInUser.email} としてサインイン中
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={doSelfCheckIn}
            className="w-full rounded-md bg-zinc-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "処理中..." : "チェックインする"}
          </button>
        </div>
      ) : view === "guest_form" ? (
        <form
          onSubmit={handleGuestSubmit}
          className="space-y-3 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            お名前とメールアドレスをご入力ください。
          </p>
          <input
            type="text"
            required
            placeholder="お名前"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <input
            type="email"
            required
            placeholder="メールアドレス"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-zinc-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "処理中..." : "チェックインする"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setView("idle")}
            className="block w-full text-center text-xs text-zinc-500 hover:underline disabled:opacity-50"
          >
            戻る
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            disabled={pending}
            onClick={handleGoogle}
            className="w-full rounded-md border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {pending ? "サインイン中..." : "Googleでログインしてチェックイン"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setView("guest_form")}
            className="w-full rounded-md bg-zinc-900 px-4 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            ゲストで続ける
          </button>
          <p className="text-center text-xs text-zinc-500">
            Googleでログインすると、参加履歴が次回以降に引き継がれます。
          </p>
        </div>
      )}
    </div>
  );
}

function prettyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Map server-action error codes to friendly Japanese messages. Anything
  // we don't recognize falls through with the raw message — better than
  // silently swallowing genuine problems.
  switch (msg) {
    case "INVALID_TOKEN":
    case "TOKEN_NOT_SET":
      return "チェックインリンクが無効です。最新のQRコードをスキャンしてください。";
    case "TOO_EARLY":
      return "イベント開始時刻まで時間があります。";
    case "TOO_LATE":
      return "チェックイン期間が終了しました。";
    case "EVENT_CANCELLED":
      return "このイベントは中止されました。";
    case "EVENT_NOT_FOUND":
      return "イベントが見つかりません。";
    case "GUEST_NAME_REQUIRED":
      return "お名前を入力してください。";
    case "GUEST_EMAIL_REQUIRED":
      return "メールアドレスを入力してください。";
    case "INVALID_ID_TOKEN":
    case "NOT_ANONYMOUS":
      return "認証に問題がありました。ページを再読み込みしてください。";
    default:
      return `エラーが発生しました: ${msg}`;
  }
}
