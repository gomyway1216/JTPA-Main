"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function QrDisplayControls({ targetId }: { targetId: string }) {
  const t = useTranslations("Admin.checkIn");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(document.fullscreenElement?.id === targetId);
    }

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, [targetId]);

  function handlePrint() {
    setError(null);
    window.print();
  }

  async function handleFullscreen() {
    setError(null);
    const target = document.getElementById(targetId);
    if (!target?.requestFullscreen) {
      setError(t("fullscreenUnsupported"));
      return;
    }

    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
        return;
      }
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      await target.requestFullscreen();
    } catch {
      setError(t("fullscreenFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-2 print:hidden">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handlePrint}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {t("print")}
        </button>
        <button
          type="button"
          onClick={handleFullscreen}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          {isFullscreen ? t("exitFullscreen") : t("fullscreen")}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
