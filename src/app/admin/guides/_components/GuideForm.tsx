"use client";

import dynamic from "next/dynamic";
import { collection, doc } from "firebase/firestore";
import { useEffect, useRef, useState, useTransition } from "react";

import type { RefMDEditor } from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  createGuide,
  deleteGuide,
  updateGuide,
  type GuideFormInput,
} from "@/app/actions/guides";
import { clientDb } from "@/lib/firebase/client";
import {
  GUIDE_IMAGE_ACCEPT,
  MAX_GUIDE_IMAGE_BYTES,
  uploadGuideImage,
} from "@/lib/firebase/uploads";
import type { GuideDoc } from "@/lib/types";

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

// Pull only image-typed files out of an arbitrary list — covers drops
// and clipboard pastes that may contain a mix of text, html, and one
// or more images.
function pickImageFiles(files: FileList | File[]): File[] {
  const arr = Array.from(files);
  return arr.filter((f) => f.type.startsWith("image/"));
}

export function GuideForm({
  mode,
  guide,
}: {
  mode: "create" | "edit";
  guide?: GuideDoc;
}) {
  const [title, setTitle] = useState(guide?.title ?? "");
  const [slug, setSlug] = useState(guide?.slug ?? "");
  const [tagsInput, setTagsInput] = useState(tagsToString(guide?.tags ?? []));
  const [status, setStatus] = useState<GuideFormInput["status"]>(
    guide?.status ?? "draft",
  );
  const [order, setOrder] = useState(String(guide?.order ?? 100));
  const [body, setBody] = useState<string>(guide?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Pre-generate a Firestore auto-id on create so images can be uploaded
  // to `guides/{guideId}/...` BEFORE the doc is saved — same id is then
  // handed back to the server action so the doc lives at exactly that
  // location. On edit we use the existing guide.id. useState's lazy
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

  function insertAtCursor(markdown: string) {
    const ta = editorRef.current?.textarea ?? null;
    if (!ta) {
      setBody((prev) => (prev.endsWith("\n") ? prev : `${prev}\n\n`) + markdown);
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = body.slice(0, start) + markdown + body.slice(end);
    setBody(next);
    // Restore cursor + focus after React commits the new value. Without
    // the rAF deferral the textarea still holds the old value and the
    // selection range lands at a stale offset.
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + markdown.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  async function uploadAndInsert(files: File[]) {
    if (files.length === 0) return;
    setError(null);
    setUploading(true);
    setUploadInfo(`${files.length} 件アップロード中...`);
    try {
      for (const file of files) {
        const url = await uploadGuideImage(guideId, file);
        const alt = file.name.replace(/\.[^.]+$/, "");
        insertAtCursor(`\n![${alt}](${url})\n`);
      }
      setUploadInfo(`${files.length} 件アップロードしました`);
      // Clear the success banner after a beat so it doesn't sit forever.
      setTimeout(() => setUploadInfo(null), 3000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "画像のアップロードに失敗しました",
      );
      setUploadInfo(null);
    } finally {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const payload: GuideFormInput = {
          title,
          slug: slug || undefined,
          body,
          tags: stringToTags(tagsInput),
          status,
          order,
        };
        if (mode === "create") {
          await createGuide(payload, guideId);
        } else if (guide) {
          await updateGuide(guide.id, payload);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存に失敗しました");
      }
    });
  }

  async function handleDelete() {
    if (!guide) return;
    if (!confirm("このガイドを削除しますか？")) return;
    startTransition(async () => {
      try {
        await deleteGuide(guide.id);
        window.location.href = "/admin/guides";
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="タイトル" required>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="スラッグ (URL)">
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="自動生成 (英小文字/数字/ハイフン)"
          className={inputCls}
        />
      </Field>
      <Field label="タグ (カンマ区切り)">
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="Claude, 環境構築, 初心者向け"
          className={inputCls}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ステータス">
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as GuideFormInput["status"])
            }
            className={inputCls}
          >
            <option value="draft">下書き</option>
            <option value="published">公開</option>
          </select>
        </Field>
        <Field label="表示順 (小さいほど上)">
          <input
            type="number"
            min={0}
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <Field label="本文 (Markdown)" required>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {uploading ? "アップロード中..." : "📷 画像をアップロード"}
            </button>
            <span className="text-xs text-zinc-500">
              ドラッグ&ドロップ / ペーストも可 (
              {MAX_GUIDE_IMAGE_BYTES / 1024 / 1024}MB以下, image/* のみ)
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
              value={body}
              onChange={(v) => setBody(v ?? "")}
              height={500}
              preview="live"
            />
          </div>
        </div>
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between">
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending || uploading}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            ガイドを削除
          </button>
        )}
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
