"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { generateCheckInToken } from "@/app/actions/check-in";

export function TokenControls({
  eventId,
  hasToken,
}: {
  eventId: string;
  hasToken: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (
      hasToken &&
      !confirm("再生成すると現在のQRコードは無効になります。続けますか？")
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await generateCheckInToken(eventId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={handleGenerate}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending
          ? "生成中..."
          : hasToken
            ? "トークンを再生成"
            : "トークンを生成"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
