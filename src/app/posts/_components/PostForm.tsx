"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { unstable_rethrow } from "next/navigation";
import {
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import type { RefMDEditor } from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  deleteMyPost,
  submitPost,
  updateMyPost,
  type PostFormInput,
  type PostReturnTo,
} from "@/app/actions/posts";
import { Field } from "@/components/forms/Field";
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  secondaryButtonClassSm,
} from "@/components/forms/styles";
import { localizedPath } from "@/i18n/paths";
import {
  CONTENT_LOCALES,
  preferredContentLocale,
  initialContentLocales,
  normalizeContentLocales,
  type ContentLocale,
} from "@/lib/content-localization";
import { clientStorage } from "@/lib/firebase/client";
import { publicDownloadUrl } from "@/lib/firebase/uploads";
import type {
  LocalizedPostContent,
  PostDoc,
  ProjectAsset,
  SessionUser,
} from "@/lib/types";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
const ACCEPT = ALLOWED_MIME.join(",");

// `@uiw/react-md-editor` reads `window` during evaluation; load on the
// client only. Same pattern as GuideForm.
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="h-96 animate-pulse rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
  ),
});

// Splits on half-width comma plus the two common full-width JP commas so
// Japanese commas work alongside ASCII commas.
function stringToTags(s: string): string[] {
  return s
    .split(/[,、，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function tagsToString(tags: string[]): string {
  return tags.join(", ");
}

function pickImageFiles(files: FileList | File[]): File[] {
  const allow = ALLOWED_MIME as readonly string[];
  return Array.from(files).filter((file) => allow.includes(file.type));
}

function escapeAlt(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

function initialPostLocales(
  post: PostDoc | undefined,
): ContentLocale[] {
  if (!post) return initialContentLocales(undefined);
  const normalized = normalizeContentLocales(post.locales);
  return normalized.length > 0 ? normalized : [...CONTENT_LOCALES];
}

function emptyPostContent(): LocalizedPostContent {
  return { title: "", excerpt: "", body: "" };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasText(value: unknown): boolean {
  return textValue(value).trim().length > 0;
}

function emptyPostContentByLocale(): Record<ContentLocale, LocalizedPostContent> {
  return Object.fromEntries(
    CONTENT_LOCALES.map((locale) => [locale, emptyPostContent()]),
  ) as Record<ContentLocale, LocalizedPostContent>;
}

function initialPostContentByLocale(
  post: PostDoc | undefined,
): Record<ContentLocale, LocalizedPostContent> {
  const next = emptyPostContentByLocale();
  if (!post) return next;

  let hasLocalized = false;
  for (const locale of CONTENT_LOCALES) {
    const content = post.localized?.[locale];
    if (!content) continue;
    next[locale] = {
      title: textValue(content.title),
      excerpt: textValue(content.excerpt),
      body: textValue(content.body),
    };
    hasLocalized = true;
  }

  if (!hasLocalized) {
    const fallbackLocale = initialPostLocales(post)[0] ?? CONTENT_LOCALES[0];
    next[fallbackLocale] = {
      title: post.title,
      excerpt: post.excerpt,
      body: post.body,
    };
  }

  return next;
}

function initialPostActiveLocale(
  post: PostDoc | undefined,
  currentLocale: string,
): ContentLocale {
  if (!post) {
    return preferredContentLocale(undefined, currentLocale) ?? CONTENT_LOCALES[0];
  }
  const localizedLocales = CONTENT_LOCALES.filter((locale) => {
    const content = post.localized?.[locale];
    return Boolean(
      content &&
        (hasText(content.title) ||
          hasText(content.excerpt) ||
          hasText(content.body)),
    );
  });
  if (localizedLocales.length > 0) {
    return preferredContentLocale(localizedLocales, currentLocale) ?? localizedLocales[0];
  }
  return initialPostLocales(post)[0] ?? CONTENT_LOCALES[0];
}

interface Props {
  mode: "create" | "edit";
  user: SessionUser;
  post?: PostDoc;
  returnTo?: PostReturnTo;
}

export function PostForm({ mode, user, post, returnTo = "my" }: Props) {
  const locale = useLocale();
  const t = useTranslations("PostForm");
  const [activeLocale, setActiveLocale] = useState<ContentLocale>(
    initialPostActiveLocale(post, locale),
  );
  const [localizedContent, setLocalizedContent] = useState<
    Record<ContentLocale, LocalizedPostContent>
  >(
    initialPostContentByLocale(post),
  );
  const [tagsInput, setTagsInput] = useState(
    tagsToString(post?.tags ?? []),
  );
  const [coverImage, setCoverImage] = useState<ProjectAsset | undefined>(
    post?.coverImage,
  );
  const [coverProgress, setCoverProgress] = useState<number | null>(null);
  const [bodyUploading, setBodyUploading] = useState(false);
  const [bodyUploadInfo, setBodyUploadInfo] = useState<string | null>(null);
  const [isDraggingBodyImage, setIsDraggingBodyImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const activeContent = localizedContent[activeLocale];
  const bodyFileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<RefMDEditor | null>(null);
  const bodyUploadingRef = useRef(false);

  function updateActiveContent(patch: Partial<LocalizedPostContent>) {
    setLocalizedContent((cur) => ({
      ...cur,
      [activeLocale]: { ...cur[activeLocale], ...patch },
    }));
  }

  function updateBodyForLocale(
    contentLocale: ContentLocale,
    updater: (prev: string) => string,
  ) {
    setLocalizedContent((cur) => ({
      ...cur,
      [contentLocale]: {
        ...cur[contentLocale],
        body: updater(cur[contentLocale].body),
      },
    }));
  }

  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColorMode(mq.matches ? "dark" : "light");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  function uploadOne(
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<ProjectAsset> {
    if (file.size > MAX_IMAGE_BYTES) {
      return Promise.reject(new Error(t("imageTooLarge")));
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return Promise.reject(new Error(t("imageType")));
    }
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    const path = `posts/${user.uid}/${Date.now()}-${safeName}`;
    const objectRef = storageRef(clientStorage, path);
    return new Promise<ProjectAsset>((resolve, reject) => {
      const task = uploadBytesResumable(objectRef, file, {
        contentType: file.type,
      });
      task.on(
        "state_changed",
        (snap) =>
          onProgress((snap.bytesTransferred / snap.totalBytes) * 100),
        (err) => reject(err),
        () => {
          // posts/{uid}/ has `allow read: if true` in storage.rules, so we
          // skip the getDownloadURL fetch entirely and build the URL from
          // the upload ref. No second network round-trip, no token in the
          // persisted Markdown body.
          resolve({ path, url: publicDownloadUrl(task.snapshot.ref) });
        },
      );
    });
  }

  async function handleCoverPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setCoverProgress(0);
      const asset = await uploadOne(file, setCoverProgress);
      setCoverImage(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setCoverProgress(null);
      e.target.value = "";
    }
  }

  async function uploadBodyImages(files: File[]) {
    if (files.length === 0) return;
    if (bodyUploadingRef.current) {
      setError(t("waitForUpload"));
      return;
    }

    const uploadLocale = activeLocale;
    bodyUploadingRef.current = true;
    setBodyUploading(true);
    setBodyUploadInfo(t("uploadingCount", { count: files.length }));
    setError(null);

    const textarea = editorRef.current?.textarea ?? null;
    const cursorStart = textarea?.selectionStart ?? null;
    const cursorEnd = textarea?.selectionEnd ?? null;

    try {
      const inserts = await Promise.all(
        files.map(async (file) => {
          const asset = await uploadOne(file, () => undefined);
          const altRaw = file.name.replace(/\.[^.]+$/, "");
          return `\n![${escapeAlt(altRaw)}](${asset.url})\n`;
        }),
      );
      const block = inserts.join("");

      if (textarea && cursorStart !== null && cursorEnd !== null) {
        updateBodyForLocale(uploadLocale, (prev) => {
          const start = Math.min(cursorStart, prev.length);
          const end = Math.min(cursorEnd, prev.length);
          return prev.slice(0, start) + block + prev.slice(end);
        });
        requestAnimationFrame(() => {
          textarea.focus();
          const safeStart = Math.min(cursorStart, textarea.value.length);
          const pos = safeStart + block.length;
          textarea.setSelectionRange(pos, pos);
        });
      } else {
        updateBodyForLocale(
          uploadLocale,
          (prev) => (prev.endsWith("\n") ? prev : `${prev}\n\n`) + block,
        );
      }

      setBodyUploadInfo(t("uploadedCount", { count: files.length }));
      setTimeout(() => setBodyUploadInfo(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("imageUploadFailed"));
      setBodyUploadInfo(null);
    } finally {
      bodyUploadingRef.current = false;
      setBodyUploading(false);
    }
  }

  function handleBodyImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    uploadBodyImages(pickImageFiles(files));
    e.target.value = "";
  }

  function handleBodyDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDraggingBodyImage(false);
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    uploadBodyImages(pickImageFiles(files));
  }

  function handleBodyPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    const images = pickImageFiles(files);
    if (images.length === 0) return;
    e.preventDefault();
    uploadBodyImages(images);
  }

  function submit(intent: "draft" | "pending") {
    setError(null);
    startTransition(async () => {
      try {
        const payload: PostFormInput = {
          localized: localizedContent,
          tags: stringToTags(tagsInput),
          coverImage,
          intent,
        };
        const res =
          mode === "create"
            ? await submitPost(payload)
            : post
              ? await updateMyPost(post.id, payload, returnTo)
              : null;
        // Both create and edit redirect on success, so a returned result is
        // always a failure — surface the real message inline instead of the
        // masked generic "Server Components render" crash.
        if (res && !res.ok) setError(res.error);
      } catch (err) {
        // Success throws the internal NEXT_REDIRECT — let it propagate so the
        // navigation actually happens. Anything else is a real save failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("saveFailed"));
      }
    });
  }

  async function handleDelete() {
    if (!post) return;
    if (!confirm(t("deleteConfirm"))) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await deleteMyPost(post.id);
        if (!res.ok) {
          // Surface the real reason (e.g. permission) instead of the masked
          // generic Server Action crash; navigate away only on success.
          setError(res.error);
          return;
        }
        const path = returnTo === "admin" ? "/admin/posts" : "/my/posts";
        window.location.href = localizedPath(path, locale);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  const uploading = coverProgress !== null || bodyUploading;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Default submit (Enter in a text field) goes through the
        // "review request" path — the more common authoring intent.
        submit("pending");
      }}
      className="space-y-4"
    >
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

        <Field label={t("title")} required htmlFor={`post-title-${activeLocale}`}>
          <input
            id={`post-title-${activeLocale}`}
            type="text"
            required
            value={activeContent.title}
            onChange={(e) => updateActiveContent({ title: e.target.value })}
            className={inputClass}
          />
        </Field>

        <Field
          label={t("excerpt")}
          required
          htmlFor={`post-excerpt-${activeLocale}`}
        >
          <textarea
            id={`post-excerpt-${activeLocale}`}
            rows={2}
            maxLength={300}
            required
            value={activeContent.excerpt}
            onChange={(e) => updateActiveContent({ excerpt: e.target.value })}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-zinc-500">
            {activeContent.excerpt.length} / 300
          </p>
        </Field>

        <Field label={t("body")} required>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || uploading}
              onClick={() => bodyFileInputRef.current?.click()}
              className={secondaryButtonClassSm}
            >
              {t("uploadImage")}
            </button>
            <input
              ref={bodyFileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              hidden
              disabled={pending || uploading}
              onChange={handleBodyImagePick}
            />
            <span className="text-xs text-zinc-500">
              {t("imageHint")}
            </span>
          </div>
          {bodyUploadInfo && (
            <p className="mb-2 text-xs text-zinc-500">{bodyUploadInfo}</p>
          )}
          <div
            data-color-mode={colorMode}
            onDragOver={(e) => {
              e.preventDefault();
              if (!isDraggingBodyImage) setIsDraggingBodyImage(true);
            }}
            onDragLeave={() => setIsDraggingBodyImage(false)}
            onDrop={handleBodyDrop}
            onPaste={handleBodyPaste}
            className={
              isDraggingBodyImage
                ? "rounded outline-2 outline-dashed outline-indigo-400"
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
        </Field>
      </div>

      <Field label={t("tags")} htmlFor="post-tags">
        <input
          id="post-tags"
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={t("tagsPlaceholder")}
          className={inputClass}
        />
      </Field>

      <Field label={t("cover")}>
        <div className="space-y-2">
          {coverImage && (
            <div className="flex items-center gap-3">
              <Image
                src={coverImage.url}
                alt={t("coverPreviewAlt")}
                width={128}
                height={80}
                className="h-20 w-32 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
              <button
                type="button"
                onClick={() => setCoverImage(undefined)}
                className="text-xs text-red-600 hover:underline"
              >
                {t("delete")}
              </button>
            </div>
          )}
          <input
            type="file"
            accept={ACCEPT}
            disabled={pending || uploading}
            onChange={handleCoverPick}
            className="block w-full text-sm disabled:opacity-50"
          />
          {coverProgress !== null && (
            <p className="text-xs text-zinc-500">
              {t("uploading", { progress: coverProgress.toFixed(0) })}
            </p>
          )}
        </div>
      </Field>

      {error && <p className={errorTextClass}>{error}</p>}
      {mode === "edit" && !user.isAdmin && (
        <p className="text-xs text-zinc-500">
          {t("editReviewNotice")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {!user.isAdmin && (
          <button
            type="button"
            disabled={pending || uploading}
            onClick={() => submit("draft")}
            className={secondaryButtonClass}
          >
            {t("saveDraft")}
          </button>
        )}
        <button
          type="submit"
          disabled={pending || uploading}
          className={primaryButtonClass}
        >
          {pending
            ? t("submitting")
            : uploading
              ? t("uploadingButton")
              : mode === "create"
                ? t("submitForReview")
                : user.isAdmin
                  ? t("save")
                  : t("updateForReview")}
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
