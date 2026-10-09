"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

interface Props {
  pollTitle: string;
  pollUrl: string;
  qrSvg: string;
}

export function PollQrDialog({ pollTitle, pollUrl, qrSvg }: Props) {
  const t = useTranslations("PollDetail");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const posterRef = useRef<HTMLDivElement>(null);
  const posterId = useId();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(document.fullscreenElement === posterRef.current);
    }

    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  function openDialog() {
    setError(null);
    dialogRef.current?.showModal();
  }

  async function toggleFullscreen() {
    setError(null);
    const poster = posterRef.current;
    if (!poster?.requestFullscreen) {
      setError(t("qrFullscreenUnsupported"));
      return;
    }

    try {
      if (document.fullscreenElement === poster) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await poster.requestFullscreen();
      }
    } catch {
      setError(t("qrFullscreenFailed"));
    }
  }

  function closeDialog() {
    if (document.fullscreenElement === posterRef.current) {
      void document.exitFullscreen();
    }
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="text-xs text-blue-600 hover:underline dark:text-blue-400"
      >
        {t("showQr")}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`${posterId}-title`}
        className="m-auto w-[min(94vw,48rem)] rounded-lg border border-zinc-200 bg-white p-0 text-zinc-950 shadow-xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      >
        <div
          ref={posterRef}
          id={posterId}
          className="flex min-h-[min(80vh,44rem)] flex-col items-center justify-center gap-5 bg-white p-6 text-center text-zinc-950 sm:p-10"
        >
          <div className="space-y-2">
            <p className="text-sm font-medium text-zinc-500">
              {t("qrHeading")}
            </p>
            <h2 id={`${posterId}-title`} className="text-2xl font-bold sm:text-3xl">
              {pollTitle}
            </h2>
          </div>
          <div
            className="rounded-md bg-white p-2 [&_svg]:h-auto [&_svg]:w-[min(68vw,28rem)]"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
          <p className="max-w-2xl break-all text-sm text-zinc-600">{pollUrl}</p>
          <p className="text-sm text-zinc-500">{t("qrHint")}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 p-4 dark:border-zinc-700">
          {error && <p className="mr-auto text-sm text-red-600">{error}</p>}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {isFullscreen ? t("exitQrFullscreen") : t("showQrFullscreen")}
          </button>
          <button
            type="button"
            onClick={closeDialog}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t("closeQr")}
          </button>
        </div>
      </dialog>
    </>
  );
}
