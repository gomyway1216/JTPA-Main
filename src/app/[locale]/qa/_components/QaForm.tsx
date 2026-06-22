"use client";

import dynamic from "next/dynamic";
import { unstable_rethrow } from "next/navigation";
import { collection, doc } from "firebase/firestore";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import type { RefMDEditor } from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  deleteMyQa,
  submitQa,
  updateMyQa,
  type QaActionResult,
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
import {
  CONTENT_LOCALES,
  initialContentLocales,
  normalizeContentLocales,
  preferredContentLocale,
  type ContentLocale,
} from "@/lib/content-localization";
import { clientDb } from "@/lib/firebase/client";
import {
  GUIDE_IMAGE_ACCEPT,
  GUIDE_IMAGE_LABEL,
  GUIDE_IMAGE_TYPES,
  MAX_GUIDE_IMAGE_BYTES,
  uploadQaImage,
} from "@/lib/firebase/uploads";
import type { LocalizedQaContent, QaDoc, SessionUser } from "@/lib/types";

// `@uiw/react-md-editor` reads `window` during evaluation; load on the
// client only. Same pattern as PostForm / GuideForm.
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="h-96 animate-pulse rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
  ),
});

// Split on half-width comma plus the two common full-width JP commas so
// Japanese commas work alongside ASCII commas.
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

function pickImageFiles(files: FileList | File[]): File[] {
  const allow = GUIDE_IMAGE_TYPES as readonly string[];
  return Array.from(files).filter((f) => allow.includes(f.type));
}

function initialQaLocales(qa: QaDoc | undefined): ContentLocale[] {
  if (!qa) return initialContentLocales(undefined);
  const normalized = normalizeContentLocales(qa.locales);
  return normalized.length > 0 ? normalized : [...CONTENT_LOCALES];
}

function emptyQaContent(): LocalizedQaContent {
  return { title: "", body: "" };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasText(value: unknown): boolean {
  return textValue(value).trim().length > 0;
}

function emptyQaContentByLocale(): Record<ContentLocale, LocalizedQaContent> {
  return Object.fromEntries(
    CONTENT_LOCALES.map((locale) => [locale, emptyQaContent()]),
  ) as Record<ContentLocale, LocalizedQaContent>;
}

function initialQaContentByLocale(
  qa: QaDoc | undefined,
): Record<ContentLocale, LocalizedQaContent> {
  const next = emptyQaContentByLocale();
  if (!qa) return next;

  let hasLocalized = false;
  for (const locale of CONTENT_LOCALES) {
    const content = qa.localized?.[locale];
    if (!content) continue;
    next[locale] = {
      title: textValue(content.title),
      body: textValue(content.body),
    };
    hasLocalized = true;
  }

  if (!hasLocalized) {
    const fallbackLocale = initialQaLocales(qa)[0] ?? CONTENT_LOCALES[0];
    next[fallbackLocale] = {
      title: qa.title,
      body: qa.body,
    };
  }

  return next;
}

function initialQaActiveLocale(
  qa: QaDoc | undefined,
  currentLocale: string,
): ContentLocale {
  if (!qa) {
    return (
      preferredContentLocale(undefined, currentLocale) ?? CONTENT_LOCALES[0]
    );
  }
  const localizedLocales = CONTENT_LOCALES.filter((locale) => {
    const content = qa.localized?.[locale];
    return Boolean(
      content && (hasText(content.title) || hasText(content.body)),
    );
  });
  if (localizedLocales.length > 0) {
    return (
      preferredContentLocale(localizedLocales, currentLocale) ??
      localizedLocales[0]
    );
  }
  return initialQaLocales(qa)[0] ?? CONTENT_LOCALES[0];
}

function escapeAlt(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

interface Props {
  mode: "create" | "edit";
  user: SessionUser;
  qa?: QaDoc;
}

export function QaForm({ mode, user, qa }: Props) {
  const locale = useLocale();
  const t = useTranslations("QaForm");
  const actionErrors = useTranslations("ActionErrors");
  const imageUploadMessages = {
    missingGuideId: () => actionErrors("guideImageMissingId"),
    missingQaId: () => actionErrors("qaImageMissingId"),
    missingUserId: () => actionErrors("userMissingId"),
    unsupportedType: (types: string) => actionErrors("imageType", { types }),
    tooLarge: (size: number) => actionErrors("imageTooLarge", { size }),
  };
  const [activeLocale, setActiveLocale] = useState<ContentLocale>(
    initialQaActiveLocale(qa, locale),
  );
  const [localizedContent, setLocalizedContent] = useState<
    Record<ContentLocale, LocalizedQaContent>
  >(initialQaContentByLocale(qa));
  const [tagsInput, setTagsInput] = useState(tagsToString(qa?.tags ?? []));
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pending, startTransition] = useTransition();
  const activeContent = localizedContent[activeLocale];

  function updateActiveContent(patch: Partial<LocalizedQaContent>) {
    setLocalizedContent((cur) => ({
      ...cur,
      [activeLocale]: { ...cur[activeLocale], ...patch },
    }));
  }

  function updateBodyForLocale(
    targetLocale: ContentLocale,
    updater: (prev: string) => string,
  ) {
    setLocalizedContent((cur) => ({
      ...cur,
      [targetLocale]: {
        ...cur[targetLocale],
        body: updater(cur[targetLocale].body),
      },
    }));
  }

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
  const editorRef = useRef<RefMDEditor | null>(null);
  const uploadingRef = useRef(false);

  async function uploadAndInsert(files: File[]) {
    if (files.length === 0) return;
    if (uploadingRef.current) {
      setError(t("waitForUpload"));
      return;
    }
    if (files.some((file) => file.size > MAX_GUIDE_IMAGE_BYTES)) {
      setError(t("imageTooLarge"));
      return;
    }
    const uploadLocale = activeLocale;
    uploadingRef.current = true;
    setError(null);
    setUploading(true);
    setUploadInfo(t("uploadingCount", { count: files.length }));

    const ta = editorRef.current?.textarea ?? null;
    const cursorStart = ta?.selectionStart ?? null;
    const cursorEnd = ta?.selectionEnd ?? null;

    try {
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const url = await uploadQaImage(
            qaId,
            user.uid,
            file,
            imageUploadMessages,
          );
          const altRaw = file.name.replace(/\.[^.]+$/, "");
          return `\n![${escapeAlt(altRaw)}](${url})\n`;
        }),
      );
      const inserts = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const block = inserts.join("");

      if (block) {
        if (ta && cursorStart !== null && cursorEnd !== null) {
          updateBodyForLocale(uploadLocale, (prev) => {
            const s = Math.min(cursorStart, prev.length);
            const e = Math.min(cursorEnd, prev.length);
            return prev.slice(0, s) + block + prev.slice(e);
          });
          requestAnimationFrame(() => {
            ta.focus();
            const safeStart = Math.min(cursorStart, ta.value.length);
            const pos = safeStart + block.length;
            ta.setSelectionRange(pos, pos);
          });
        } else {
          updateBodyForLocale(
            uploadLocale,
            (prev) => (prev.endsWith("\n") ? prev : `${prev}\n\n`) + block,
          );
        }
      }

      const failed = results.find((result) => result.status === "rejected");
      if (failed) {
        const reason = failed.reason;
        setError(
          reason instanceof Error ? reason.message : t("imageUploadFailed"),
        );
      }
      setUploadInfo(
        inserts.length > 0
          ? t("uploadedCount", { count: inserts.length })
          : null,
      );
      if (inserts.length > 0) {
        setTimeout(() => setUploadInfo(null), 3000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("imageUploadFailed"));
      setUploadInfo(null);
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    uploadAndInsert(pickImageFiles(files));
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    const imgs = pickImageFiles(files);
    if (imgs.length === 0) return;
    uploadAndInsert(imgs);
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    const imgs = pickImageFiles(files);
    if (imgs.length === 0) return;
    e.preventDefault();
    uploadAndInsert(imgs);
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
      localized: localizedContent,
      tags: stringToTags(tagsInput),
    };
    startTransition(async () => {
      try {
        let res: QaActionResult | null = null;
        if (mode === "create") {
          res = await submitQa(payload);
        } else if (qa) {
          res = await updateMyQa(qa.id, payload);
        }
        // submitQa/updateMyQa redirect on success, so a returned result is
        // always a failure — surface it and stop (don't fall through to any
        // success handling added later). Mirrors EventForm.
        if (res && !res.ok) {
          setError(res.error);
          return;
        }
      } catch (err) {
        // submitQa/updateMyQa redirect on success, throwing the internal
        // NEXT_REDIRECT; let unstable_rethrow pass that through and surface
        // anything else as a real failure.
        unstable_rethrow(err);
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
        // deleteMyQa redirects on success (and on an already-deleted doc),
        // so a returned result is always the forbidden { ok: false } case.
        const res = await deleteMyQa(qa.id);
        if (!res.ok) setError(res.error);
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  const canSubmit = CONTENT_LOCALES.some((value) => {
    const content = localizedContent[value];
    return content.title.trim().length >= 2 && content.body.trim().length > 0;
  });

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-4">
        <div
          role="group"
          aria-label={t("localization")}
          className="flex flex-wrap gap-2"
        >
          {CONTENT_LOCALES.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={activeLocale === value}
              disabled={pending || uploading}
              onClick={() => setActiveLocale(value)}
              className={`min-h-10 rounded-md border px-3 py-2 text-sm font-medium transition ${
                activeLocale === value
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {t(`locales.${value}`)}
            </button>
          ))}
        </div>

        <Field label={t("title")} required htmlFor={`qa-title-${activeLocale}`}>
          <input
            id={`qa-title-${activeLocale}`}
            type="text"
            aria-required="true"
            maxLength={120}
            value={activeContent.title}
            onChange={(e) => updateActiveContent({ title: e.target.value })}
            placeholder={t("titlePlaceholder")}
            className={inputClass}
          />
        </Field>
      </div>

      <Field label={t("body")} required>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending || uploading}
              className={secondaryButtonClassSm}
            >
              {uploading ? t("uploading") : `📷 ${t("uploadImage")}`}
            </button>
            <span className="text-xs text-zinc-500">
              {t("imageHint", {
                types: GUIDE_IMAGE_LABEL,
                size: MAX_GUIDE_IMAGE_BYTES / 1024 / 1024,
              })}
            </span>
            {uploadInfo && (
              <span className="text-xs text-emerald-700 dark:text-emerald-300">
                {uploadInfo}
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={GUIDE_IMAGE_ACCEPT}
            multiple
            hidden
            onChange={handleFileInputChange}
          />
          <div
            data-color-mode={colorMode}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDragging) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onPaste={handlePaste}
            className={
              isDragging
                ? "rounded outline-2 outline-dashed outline-blue-400"
                : undefined
            }
          >
            <MDEditor
              ref={editorRef}
              value={activeContent.body}
              onChange={(v) => updateActiveContent({ body: v ?? "" })}
              height={500}
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
          disabled={pending || uploading || !canSubmit}
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
