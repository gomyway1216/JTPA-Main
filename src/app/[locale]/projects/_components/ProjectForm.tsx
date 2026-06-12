"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { unstable_rethrow } from "next/navigation";
import {
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useTransition } from "react";

import type { RefMDEditor } from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  deleteMyProject,
  submitProject,
  updateMyProject,
  type ProjectReturnTo,
} from "@/app/actions/projects";
import { Field } from "@/components/forms/Field";
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClassSm,
} from "@/components/forms/styles";
import { useRouter } from "@/i18n/navigation";
import { clientStorage } from "@/lib/firebase/client";
import { publicDownloadUrl } from "@/lib/firebase/uploads";
import type { ProjectAsset, ProjectDoc, SessionUser } from "@/lib/types";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // matches storage.rules
const MAX_SCREENSHOTS = 8;
// Allowlist used by both the <input accept=...> hint and the runtime MIME
// check. SVG is deliberately excluded — `<img src=svg>` doesn't execute its
// scripts, but admins re-displaying via other means (downloads, direct
// links) could be tricked into rendering the markup. Stick to raster.
const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
const ACCEPT = ALLOWED_MIME.join(",");

// `@uiw/react-md-editor` reads `window` during evaluation, so keep it
// client-only. The pattern matches GuideForm and PostForm.
const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="h-72 animate-pulse rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
  ),
});

function pickImageFiles(files: FileList | File[]): File[] {
  const allow = ALLOWED_MIME as readonly string[];
  return Array.from(files).filter((f) => allow.includes(f.type));
}

function escapeAlt(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/]/g, "\\]");
}

interface Props {
  mode: "create" | "edit";
  user: SessionUser;
  project?: ProjectDoc;
  returnTo?: ProjectReturnTo;
}

export function ProjectForm({ mode, user, project, returnTo = "my" }: Props) {
  const t = useTranslations("ProjectForm");
  const router = useRouter();
  const [title, setTitle] = useState(project?.title ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [tags, setTags] = useState(project?.tags?.join(", ") ?? "");
  const [appUrl, setAppUrl] = useState(project?.appUrl ?? "");
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "");
  const [demoVideoUrl, setDemoVideoUrl] = useState(project?.demoVideoUrl ?? "");
  const [thumbnail, setThumbnail] = useState<ProjectAsset | undefined>(
    project?.thumbnail,
  );
  const [screenshots, setScreenshots] = useState<ProjectAsset[]>(
    project?.screenshots ?? [],
  );
  const [thumbProgress, setThumbProgress] = useState<number | null>(null);
  const [shotProgress, setShotProgress] = useState<number | null>(null);
  const [inlineProgress, setInlineProgress] = useState<number | null>(null);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletePending, startDeleteTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<RefMDEditor | null>(null);
  const uploadingRef = useRef(false);

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
    const path = `projects/${user.uid}/${Date.now()}-${safeName}`;
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
          // projects/{uid}/ is publicly readable per storage.rules; no
          // token needed in the URL we hand back. See uploads.ts.
          resolve({ path, url: publicDownloadUrl(task.snapshot.ref) });
        },
      );
    });
  }

  async function handleThumbnailPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setThumbProgress(0);
      const asset = await uploadOne(file, setThumbProgress);
      setThumbnail(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setThumbProgress(null);
      e.target.value = ""; // allow re-picking the same file
    }
  }

  async function handleScreenshotPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const remaining = MAX_SCREENSHOTS - screenshots.length;
    if (remaining <= 0) {
      setError(t("tooManyScreenshots", { count: MAX_SCREENSHOTS }));
      return;
    }
    const toUpload = files.slice(0, remaining);
    for (const file of toUpload) {
      try {
        setShotProgress(0);
        const asset = await uploadOne(file, setShotProgress);
        setScreenshots((cur) => [...cur, asset]);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("uploadFailed"));
        setShotProgress(null);
        e.target.value = "";
        return;
      }
    }
    setShotProgress(null);
    e.target.value = "";
  }

  async function uploadAndInsert(files: File[]) {
    if (files.length === 0) return;
    if (uploadingRef.current) {
      setError(t("waitForUpload"));
      return;
    }
    uploadingRef.current = true;
    setError(null);
    setInlineProgress(0);
    setUploadInfo(t("uploadingCount", { count: files.length }));

    const ta = editorRef.current?.textarea ?? null;
    const cursorStart = ta?.selectionStart ?? null;
    const cursorEnd = ta?.selectionEnd ?? null;

    try {
      const inserts: string[] = [];
      for (const file of files) {
        const asset = await uploadOne(file, setInlineProgress);
        const altRaw = file.name.replace(/\.[^.]+$/, "");
        inserts.push(`\n![${escapeAlt(altRaw)}](${asset.url})\n`);
      }
      const block = inserts.join("");

      if (ta && cursorStart !== null && cursorEnd !== null) {
        setDescription((prev) => {
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
        setDescription(
          (prev) => (prev.endsWith("\n") ? prev : `${prev}\n\n`) + block,
        );
      }

      setUploadInfo(t("uploadedCount", { count: files.length }));
      setTimeout(() => setUploadInfo(null), 3000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("imageUploadFailed"),
      );
      setUploadInfo(null);
    } finally {
      uploadingRef.current = false;
      setInlineProgress(null);
    }
  }

  function handleInlineImagePick(e: React.ChangeEvent<HTMLInputElement>) {
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
        if (f && (ALLOWED_MIME as readonly string[]).includes(f.type)) {
          files.push(f);
        }
      }
    }
    if (files.length === 0) return;
    e.preventDefault();
    uploadAndInsert(files);
  }

  function removeScreenshot(index: number) {
    setScreenshots((cur) => cur.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const payload = {
          title,
          description,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          appUrl,
          repoUrl,
          demoVideoUrl,
          thumbnail,
          screenshots,
        };
        const res =
          mode === "create"
            ? await submitProject(payload)
            : project
              ? await updateMyProject(project.id, payload, returnTo)
              : null;
        // Both create and edit redirect on success, so a returned result is
        // always a failure — surface the real message inline instead of the
        // masked generic "Server Components render" crash.
        if (res && !res.ok) setError(res.error);
      } catch (err) {
        // Success throws the internal NEXT_REDIRECT — let it propagate so the
        // navigation actually happens. Anything else is a real failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("submitFailed"));
      }
    });
  }

  async function handleDelete() {
    if (!project) return;
    if (!confirm(t("deleteConfirm"))) return;
    setError(null);
    startDeleteTransition(async () => {
      try {
        const res = await deleteMyProject(project.id);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.push(returnTo === "admin" ? "/admin/projects" : "/my/projects");
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  const uploading =
    thumbProgress !== null ||
    shotProgress !== null ||
    inlineProgress !== null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label={t("title")} required htmlFor="project-title">
        <input
          id="project-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label={t("description")} required>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className={secondaryButtonClassSm}
            >
              {inlineProgress !== null ? t("uploadingButton") : t("uploadImage")}
            </button>
            <span className="text-xs text-zinc-500">
              {t("imageHint")}
            </span>
            {uploadInfo && (
              <span className="text-xs text-emerald-700 dark:text-emerald-300">
                {uploadInfo}
              </span>
            )}
            {inlineProgress !== null && (
              <span className="text-xs text-zinc-500">
                {t("uploading", { progress: inlineProgress.toFixed(0) })}
              </span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={handleInlineImagePick}
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
              value={description}
              onChange={(v) => setDescription(v ?? "")}
              height={360}
              preview="live"
            />
          </div>
        </div>
      </Field>
      <Field label={t("tags")} htmlFor="project-tags">
        <input
          id="project-tags"
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="LLM, RAG, Agent"
          className={inputClass}
        />
      </Field>
      <Field label={t("appUrl")} htmlFor="project-app-url">
        <input
          id="project-app-url"
          type="url"
          value={appUrl}
          onChange={(e) => setAppUrl(e.target.value)}
          placeholder={t("appUrlPlaceholder")}
          className={inputClass}
        />
      </Field>
      <Field label={t("repoUrl")} htmlFor="project-repo-url">
        <input
          id="project-repo-url"
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label={t("demoVideoUrl")} htmlFor="project-demo-url">
        <input
          id="project-demo-url"
          type="url"
          value={demoVideoUrl}
          onChange={(e) => setDemoVideoUrl(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label={t("cover")}>
        <div className="space-y-2">
          {thumbnail && (
            <div className="flex items-center gap-3">
              <Image
                src={thumbnail.url}
                alt={t("thumbnailPreviewAlt")}
                width={80}
                height={80}
                className="h-20 w-20 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
              <button
                type="button"
                onClick={() => setThumbnail(undefined)}
                className="text-xs text-red-600 hover:underline"
              >
                {t("delete")}
              </button>
            </div>
          )}
          <input
            type="file"
            accept={ACCEPT}
            onChange={handleThumbnailPick}
            className="block w-full text-sm"
          />
          {thumbProgress !== null && (
            <p className="text-xs text-zinc-500">
              {t("uploading", { progress: thumbProgress.toFixed(0) })}
            </p>
          )}
        </div>
      </Field>

      <Field label={t("screenshots", { count: MAX_SCREENSHOTS })}>
        <div className="space-y-2">
          {screenshots.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {screenshots.map((s, i) => (
                <li key={s.path} className="relative">
                  <Image
                    src={s.url}
                    alt={`screenshot ${i + 1}`}
                    width={160}
                    height={96}
                    sizes="(max-width: 640px) 33vw, 152px"
                    className="h-24 w-full rounded border border-zinc-200 object-cover dark:border-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={() => removeScreenshot(i)}
                    className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80"
                  >
                    {t("delete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {screenshots.length < MAX_SCREENSHOTS && (
            <input
              type="file"
              accept={ACCEPT}
              multiple
              onChange={handleScreenshotPick}
              className="block w-full text-sm"
            />
          )}
          {shotProgress !== null && (
            <p className="text-xs text-zinc-500">
              {t("uploading", { progress: shotProgress.toFixed(0) })}
            </p>
          )}
          <p className="text-xs text-zinc-500">
            {t("screenshotCount", {
              current: screenshots.length,
              max: MAX_SCREENSHOTS,
            })}
          </p>
        </div>
      </Field>

      {error && <p className={errorTextClass}>{error}</p>}
      {mode === "edit" && !user.isAdmin && (
        <p className="text-xs text-zinc-500">
          {t("editReviewNotice")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || deletePending || uploading}
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
            disabled={pending || deletePending || uploading}
            onClick={handleDelete}
            className={`ml-auto ${dangerButtonClass}`}
          >
            {deletePending ? `${t("delete")}...` : t("deleteProject")}
          </button>
        )}
      </div>
    </form>
  );
}
