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
  deleteGuide,
  submitGuide,
  updateGuide,
  type GuideFormInput,
} from "@/app/actions/guides";
import { Field } from "@/components/forms/Field";
import { SaveFlash } from "@/components/forms/SaveFlash";
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
  uploadGuideImage,
} from "@/lib/firebase/uploads";
import type { GuideDoc, LocalizedGuideContent, SessionUser } from "@/lib/types";

// `@uiw/react-md-editor` reads `window` during evaluation, so it has to
// load on the client only.
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="h-72 animate-pulse rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
  ),
});

function tagsToString(tags: string[]): string {
  return tags.join(", ");
}

// Splits on half-width comma plus the two common full-width Japanese
// commas — typing a tag list on a JP IME often produces `、` or `，`,
// and accepting only `,` would treat the whole input as one tag.
function stringToTags(s: string): string[] {
  return s
    .split(/[,、，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Pull only allowlisted images out of an arbitrary list — covers drops
// and clipboard pastes that may contain a mix of text, html, and one
// or more images. Matches the SVG-exclusion the rest of the app applies
// to user-uploaded raster content.
function pickImageFiles(files: FileList | File[]): File[] {
  const allow = GUIDE_IMAGE_TYPES as readonly string[];
  return Array.from(files).filter((f) => allow.includes(f.type));
}

function initialGuideLocales(guide: GuideDoc | undefined): ContentLocale[] {
  if (!guide) return initialContentLocales(undefined);
  const normalized = normalizeContentLocales(guide.locales);
  return normalized.length > 0 ? normalized : [...CONTENT_LOCALES];
}

function emptyGuideContent(): LocalizedGuideContent {
  return { title: "", body: "" };
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function hasText(value: unknown): boolean {
  return textValue(value).trim().length > 0;
}

function emptyGuideContentByLocale(): Record<
  ContentLocale,
  LocalizedGuideContent
> {
  return Object.fromEntries(
    CONTENT_LOCALES.map((locale) => [locale, emptyGuideContent()]),
  ) as Record<ContentLocale, LocalizedGuideContent>;
}

function initialGuideContentByLocale(
  guide: GuideDoc | undefined,
): Record<ContentLocale, LocalizedGuideContent> {
  const next = emptyGuideContentByLocale();
  if (!guide) return next;

  let hasLocalized = false;
  for (const locale of CONTENT_LOCALES) {
    const content = guide.localized?.[locale];
    if (!content) continue;
    next[locale] = {
      title: textValue(content.title),
      body: textValue(content.body),
    };
    hasLocalized = true;
  }

  if (!hasLocalized) {
    const fallbackLocale = initialGuideLocales(guide)[0] ?? CONTENT_LOCALES[0];
    next[fallbackLocale] = {
      title: guide.title,
      body: guide.body,
    };
  }

  return next;
}

function initialGuideActiveLocale(
  guide: GuideDoc | undefined,
  currentLocale: string,
): ContentLocale {
  if (!guide) {
    return (
      preferredContentLocale(undefined, currentLocale) ?? CONTENT_LOCALES[0]
    );
  }
  const localizedLocales = CONTENT_LOCALES.filter((locale) => {
    const content = guide.localized?.[locale];
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
  return initialGuideLocales(guide)[0] ?? CONTENT_LOCALES[0];
}

// Markdown image syntax is `![alt](url)`. An unescaped `]` in the alt
// text closes the alt segment early; a stray backslash gets read as an
// escape for the next char. Both are common enough in real filenames
// ("Screenshot [draft].png", paths with `\`) to merit escaping.
function escapeAlt(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

export function GuideForm({
  mode,
  user,
  guide,
}: {
  mode: "create" | "edit";
  user: SessionUser;
  guide?: GuideDoc;
}) {
  const locale = useLocale();
  const t = useTranslations("GuideForm");
  const actionErrors = useTranslations("ActionErrors");
  const imageUploadMessages = {
    missingGuideId: () => actionErrors("guideImageMissingId"),
    missingQaId: () => actionErrors("qaImageMissingId"),
    missingUserId: () => actionErrors("userMissingId"),
    unsupportedType: (types: string) => actionErrors("imageType", { types }),
    tooLarge: (size: number) => actionErrors("imageTooLarge", { size }),
  };
  // Admin / editor / contributor — anyone trusted to self-publish without
  // going through the admin review queue. Plain signed-in users see the
  // submit-for-review button instead of the direct-publish button.
  const canPublishDirectly =
    user.isAdmin || user.isEditor || user.isContributor;
  // Subset of `canPublishDirectly`: only admin/editor have `/admin/*`
  // route access. Used for post-delete redirects — contributors get
  // bounced from the admin layout, so they need to land on /my/guides.
  const hasAdminAccess = user.isAdmin || user.isEditor;

  const [activeLocale, setActiveLocale] = useState<ContentLocale>(
    initialGuideActiveLocale(guide, locale),
  );
  const [localizedContent, setLocalizedContent] = useState<
    Record<ContentLocale, LocalizedGuideContent>
  >(initialGuideContentByLocale(guide));
  const [slug, setSlug] = useState(guide?.slug ?? "");
  const [tagsInput, setTagsInput] = useState(tagsToString(guide?.tags ?? []));
  const [order, setOrder] = useState(String(guide?.order ?? 100));
  const [error, setError] = useState<string | null>(null);
  // Bumped to `Date.now()` when save succeeds on the edit path —
  // updateGuide doesn't redirect, so without this the user gets no
  // confirmation that their click did anything. SaveFlash uses the
  // value as a key to restart its visibility timer.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const activeContent = localizedContent[activeLocale];

  function updateActiveContent(patch: Partial<LocalizedGuideContent>) {
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

  // Pre-generate a Firestore auto-id on create so images can be uploaded
  // to `guides/{guideId}/{uid}/...` BEFORE the doc is saved — same id is
  // then handed back to the server action so the doc lives at exactly
  // that location. On edit we use the existing guide.id. useState's lazy
  // initializer keeps the id stable across re-renders.
  const [guideId] = useState<string>(() => {
    if (guide?.id) return guide.id;
    return doc(collection(clientDb, "guides")).id;
  });

  // The app drives dark mode off `prefers-color-scheme` (see globals.css),
  // not a `.dark` class on <html>, so we sync MDEditor's `data-color-mode`
  // off matchMedia rather than a MutationObserver. Renders one editor
  // instance instead of duplicating it for each theme.
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColorMode(mq.matches ? "dark" : "light");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Hidden file input drives the toolbar button. Keep a ref so we can
  // trigger the native picker programmatically.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Ref into MDEditor so image insertions can target the caret rather
  // than always appending at the end. The editor's lazy load means this
  // is null on the first render — we fall back to an append in that
  // case, which is rare in practice (user has to drop something before
  // the editor finishes loading).
  const editorRef = useRef<RefMDEditor | null>(null);
  // Synchronous concurrency guard. State-based gating (`if (uploading)`)
  // would race when drag/drop/paste fire faster than React can flip the
  // flag — a ref updates immediately and is reliable.
  const uploadingRef = useRef(false);

  async function uploadAndInsert(files: File[]) {
    if (files.length === 0) return;
    if (uploadingRef.current) {
      setError(t("waitForUpload"));
      return;
    }
    const uploadLocale = activeLocale;
    uploadingRef.current = true;
    setError(null);
    setUploading(true);
    setUploadInfo(t("uploadingCount", { count: files.length }));

    // Snapshot the caret BEFORE we kick off uploads. Splicing once at the
    // end (rather than per-image) keeps the math simple and avoids the
    // stale-state trap of reading the body from the closure inside an
    // async loop. We use a functional state update at splice time so anything
    // the user typed during the upload window is preserved.
    const ta = editorRef.current?.textarea ?? null;
    const cursorStart = ta?.selectionStart ?? null;
    const cursorEnd = ta?.selectionEnd ?? null;

    try {
      const inserts: string[] = [];
      for (const file of files) {
        // Pass the uid so the upload lands under the per-user subfolder
        // `guides/{guideId}/{uid}/...` — Storage rules constrain writes
        // there to the uploader, which lets non-admin contributors
        // attach body images without granting them access to anyone
        // else's guide assets.
        const url = await uploadGuideImage(
          guideId,
          user.uid,
          file,
          imageUploadMessages,
        );
        const altRaw = file.name.replace(/\.[^.]+$/, "");
        inserts.push(`\n![${escapeAlt(altRaw)}](${url})\n`);
      }
      const block = inserts.join("");

      if (ta && cursorStart !== null && cursorEnd !== null) {
        updateBodyForLocale(uploadLocale, (prev) => {
          // Clamp the snapshot offsets to the current length — if the
          // user typed (or, more importantly, deleted) during upload,
          // the original indices may now point past the end of the
          // string. Clamping degrades to "insert at the closest valid
          // position" rather than throwing.
          const s = Math.min(cursorStart, prev.length);
          const e = Math.min(cursorEnd, prev.length);
          return prev.slice(0, s) + block + prev.slice(e);
        });
        // Restore caret on the next paint so React has flushed the new
        // value into the textarea. Clamp again for the same reason.
        requestAnimationFrame(() => {
          ta.focus();
          const safeStart = Math.min(cursorStart, ta.value.length);
          const pos = safeStart + block.length;
          ta.setSelectionRange(pos, pos);
        });
      } else {
        // Editor still lazy-loading — append at the end.
        updateBodyForLocale(
          uploadLocale,
          (prev) => (prev.endsWith("\n") ? prev : `${prev}\n\n`) + block,
        );
      }

      setUploadInfo(t("uploadedCount", { count: files.length }));
      setTimeout(() => setUploadInfo(null), 3000);
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
    // Reset the input so the same filename can be picked twice in a row
    // (otherwise onChange won't fire on the re-pick).
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
        if (f && f.type.startsWith("image/")) files.push(f);
      }
    }
    if (files.length === 0) return;
    // Only swallow the paste when we're actually handling an image —
    // text pastes into the editor still go through normally.
    e.preventDefault();
    uploadAndInsert(files);
  }

  // Mirror of PostForm: the form has two save buttons, one per intent.
  // - "draft"     : save without asking for review (or unpublishing)
  // - "pending"   : (re)submit for admin review
  // - "published" : self-publish (only enabled when `canPublishDirectly`)
  // For non-trusted authors a server-side guard in `submitGuide` /
  // `updateGuide` also downgrades any sneaky `published` payload back to
  // `pending`, so the gate isn't load-bearing for security — it's a UX
  // hint.
  function submit(intent: "draft" | "pending" | "published") {
    setError(null);
    startTransition(async () => {
      try {
        const payload: GuideFormInput = {
          localized: localizedContent,
          slug: slug || undefined,
          tags: stringToTags(tagsInput),
          status: intent,
          order,
        };
        const res =
          mode === "create"
            ? await submitGuide(payload, guideId)
            : guide
              ? await updateGuide(guide.id, payload)
              : null;
        if (res && !res.ok) {
          setError(res.error);
          return;
        }
        // Update path doesn't redirect; surface explicit saved feedback
        // so the click feels acknowledged. Create redirects via
        // the Server Action (so res is unreachable on create success);
        // gating on res?.ok also avoids a false flash if res is null.
        if (res?.ok) setSavedAt(Date.now());
      } catch (err) {
        // Server-Action `redirect()` (and `notFound()`, etc.) signal
        // navigation by throwing an internal Next.js error.
        // `unstable_rethrow` is the documented way to let those
        // propagate from a try/catch — it re-throws on internal errors
        // and returns silently for anything else, which we then
        // surface as a real save failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("saveFailed"));
      }
    });
  }

  async function handleDelete() {
    if (!guide) return;
    if (!confirm(t("deleteConfirm"))) return;
    startTransition(async () => {
      try {
        const res = await deleteGuide(guide.id);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        // Admin / editor land on the admin guides list; everyone else
        // (contributors + plain authors) bounces back to /my/guides
        // where they can see the rest of their submissions. The admin
        // layout redirects contributors away from `/admin/*` so sending
        // them there would be a worse experience.
        window.location.href = hasAdminAccess
          ? localizedPath("/admin/guides", locale)
          : localizedPath("/my/guides", locale);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // Default submit (Enter in a text field) goes through the most
        // common intent for this caller: "published" for trusted authors,
        // "pending" for plain users.
        submit(canPublishDirectly ? "published" : "pending");
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

        <Field
          label={t("title")}
          required
          htmlFor={`guide-title-${activeLocale}`}
        >
          <input
            id={`guide-title-${activeLocale}`}
            type="text"
            required
            value={activeContent.title}
            onChange={(e) => updateActiveContent({ title: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label={t("slug")} htmlFor="guide-slug">
        <input
          id="guide-slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={t("slugPlaceholder")}
          className={inputClass}
        />
      </Field>
      <Field label={t("tags")} htmlFor="guide-tags">
        <input
          id="guide-tags"
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={t("tagsPlaceholder")}
          className={inputClass}
        />
      </Field>
      {/* Admin/editor see the order knob; plain contributors don't —
          admin sets the order during review so community guides slot
          in without authors stepping on the curated set. */}
      {(user.isAdmin || user.isEditor) && (
        <Field label={t("order")} htmlFor="guide-order">
          <input
            id="guide-order"
            type="number"
            min={0}
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className={inputClass}
          />
        </Field>
      )}

      <Field label={t("body")} required>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
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

      {error && <p className={errorTextClass}>{error}</p>}
      {mode === "edit" && !canPublishDirectly && (
        <p className="text-xs text-zinc-500">{t("editReviewNotice")}</p>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending || uploading}
            onClick={() => submit("draft")}
            className={secondaryButtonClass}
          >
            {t("saveDraft")}
          </button>
          {canPublishDirectly ? (
            <button
              type="submit"
              disabled={pending || uploading}
              className={primaryButtonClass}
            >
              {pending ? t("saving") : t("publish")}
            </button>
          ) : (
            <button
              type="submit"
              disabled={pending || uploading}
              className={primaryButtonClass}
            >
              {pending
                ? t("submitting")
                : mode === "create"
                  ? t("submitForReview")
                  : t("resubmitForReview")}
            </button>
          )}
          <SaveFlash savedAt={savedAt} message={t("saved")} />
        </div>
        {mode === "edit" && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || uploading}
            className={dangerButtonClass}
          >
            {t("deleteGuide")}
          </button>
        )}
      </div>
    </form>
  );
}
