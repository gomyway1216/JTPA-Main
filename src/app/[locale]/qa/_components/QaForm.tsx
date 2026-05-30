"use client";

import dynamic from "next/dynamic";
import { collection, doc } from "firebase/firestore";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  deleteMyQa,
  submitQa,
  updateMyQa,
  type QaFormInput,
} from "@/app/actions/qa";
import { Field } from "@/components/forms/Field";
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClassSm,
} from "@/components/forms/styles";
import { clientDb } from "@/lib/firebase/client";
import {
  GUIDE_IMAGE_ACCEPT,
  GUIDE_IMAGE_LABEL,
  MAX_GUIDE_IMAGE_BYTES,
  uploadQaImage,
} from "@/lib/firebase/uploads";
import type { QaDoc, SessionUser } from "@/lib/types";

// `@uiw/react-md-editor` reads `window` during evaluation; load on the
// client only. Same pattern as PostForm / GuideForm.
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="h-96 animate-pulse rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
  ),
});

// Split on half-width comma plus the two common full-width JP commas so
// `タグA、タグB，タグC` works alongside `tagA, tagB`.
function stringToTags(s: string): string[] {
  return s
    .split(/[,、，]/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
}
function tagsToString(tags: string[]): string {
  return tags.join(", ");
}

interface Props {
  mode: "create" | "edit";
  user: SessionUser;
  qa?: QaDoc;
}

export function QaForm({ mode, user, qa }: Props) {
  const t = useTranslations("QaForm");
  const [title, setTitle] = useState(qa?.title ?? "");
  const [body, setBody] = useState<string>(qa?.body ?? "");
  const [tagsInput, setTagsInput] = useState(tagsToString(qa?.tags ?? []));
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  // Pre-generate a Firestore auto-id on create so the user can upload
  // images to `qa/{qaId}/...` before the doc itself is saved. The same
  // id is then handed back to submitQa so the doc lives at exactly that
  // location. On edit we use the existing qa.id. useState's lazy
  // initializer keeps the id stable across re-renders.
  const [qaId] = useState<string>(() => {
    if (qa?.id) return qa.id;
    return doc(collection(clientDb, "qa")).id;
  });

  // MDEditor's preview theme follows the OS theme.
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColorMode(mq.matches ? "dark" : "light");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_GUIDE_IMAGE_BYTES) {
      setError(t("imageTooLarge"));
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const url = await uploadQaImage(qaId, user.uid, file);
      const alt = file.name.replace(/\.[^.]+$/, "");
      // Append the image link at the end of the body. Simpler than the
      // GuideForm caret-aware insertion — Q&A bodies tend to be short
      // and the user can rearrange afterwards.
      setBody((prev) => `${prev}${prev && !prev.endsWith("\n") ? "\n\n" : ""}![${alt}](${url})\n`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload: QaFormInput = {
      // Pass the pre-generated qaId on create so the doc lands at
      // exactly the id we used for `qa/{qaId}/...` image uploads.
      // Without this, submitQa would assign a different random id and
      // images would orphan under the wrong prefix.
      ...(mode === "create" ? { id: qaId } : {}),
      title: title.trim(),
      body: body.trim(),
      tags: stringToTags(tagsInput),
    };
    startTransition(async () => {
      try {
        if (mode === "create") {
          await submitQa(payload);
        } else if (qa) {
          await updateMyQa(qa.id, payload);
        }
      } catch (err) {
        // `redirect()` throws an internal error to trigger navigation;
        // let those re-throw. Other errors surface to the user.
        const digest = (err as { digest?: unknown })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        setError(err instanceof Error ? err.message : t("submitFailed"));
      }
    });
  }

  async function handleDelete() {
    if (!qa) return;
    if (!confirm(t("deleteConfirm"))) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteMyQa(qa.id);
      } catch (err) {
        const digest = (err as { digest?: unknown })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label={t("title")} required htmlFor="qa-title">
        <input
          id="qa-title"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("titlePlaceholder")}
          className={inputClass}
        />
      </Field>

      <Field label={t("body")} required>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending || uploading}
              className={secondaryButtonClassSm}
            >
              {uploading ? t("uploading") : `📷 ${t("addImage")}`}
            </button>
            <span className="text-xs text-zinc-500">
              {t("imageHint", { types: GUIDE_IMAGE_LABEL })}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept={GUIDE_IMAGE_ACCEPT}
              onChange={handleImagePick}
              className="hidden"
            />
          </div>
          <div data-color-mode={colorMode}>
            <MDEditor
              value={body}
              onChange={(v) => setBody(v ?? "")}
              height={400}
              preview="live"
            />
          </div>
        </div>
      </Field>

      <Field label={t("tags")} htmlFor="qa-tags">
        <input
          id="qa-tags"
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={t("tagsPlaceholder")}
          className={inputClass}
        />
      </Field>

      {error && <p className={errorTextClass}>{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || uploading || !title.trim() || !body.trim()}
          className={primaryButtonClass}
        >
          {pending
            ? t("submitting")
            : uploading
              ? t("uploadingButton")
              : mode === "create"
                ? t("submit")
                : t("update")}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className={`ml-auto ${dangerButtonClass}`}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </form>
  );
}
