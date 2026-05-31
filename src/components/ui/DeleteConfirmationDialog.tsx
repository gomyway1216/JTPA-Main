"use client";

import { useEffect, useId, useRef } from "react";
import { useTranslations } from "next-intl";

import {
  dangerButtonClass,
  secondaryButtonClass,
} from "@/components/forms/styles";

interface Props {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending = false,
  onCancel,
  onConfirm,
}: Props) {
  const t = useTranslations("DeleteConfirmation");
  const titleId = useId();
  const descriptionId = useId();
  const noteId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, pending, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      onMouseDown={() => {
        if (!pending) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${noteId}`}
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2
          id={titleId}
          className="text-base font-semibold text-zinc-950 dark:text-zinc-50"
        >
          {title}
        </h2>
        <p
          id={descriptionId}
          className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-300"
        >
          {description ?? t("description")}
        </p>
        <p id={noteId} className="mt-2 text-sm text-red-700 dark:text-red-300">
          {t("cannotUndo")}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onCancel}
            disabled={pending}
            className={secondaryButtonClass}
          >
            {cancelLabel ?? t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={dangerButtonClass}
          >
            {pending ? t("deleting") : confirmLabel ?? t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
