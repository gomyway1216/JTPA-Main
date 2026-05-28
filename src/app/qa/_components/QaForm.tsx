"use client";

import dynamic from "next/dynamic";
import { collection, doc } from "firebase/firestore";
import { useEffect, useRef, useState, useTransition } from "react";

import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  deleteMyQa,
  submitQa,
  updateMyQa,
  type QaFormInput,
} from "@/app/actions/qa";
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
      setError("画像サイズは 5MB 以下にしてください");
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
      setError(err instanceof Error ? err.message : "アップロード失敗");
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
        setError(err instanceof Error ? err.message : "送信に失敗しました");
      }
    });
  }

  async function handleDelete() {
    if (!qa) return;
    if (!confirm("この質問を削除しますか？")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteMyQa(qa.id);
      } catch (err) {
        const digest = (err as { digest?: unknown })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw err;
        }
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="タイトル" required htmlFor="qa-title">
        <input
          id="qa-title"
          type="text"
          required
          minLength={2}
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例: Claude Code でテスト書かせるコツは？"
          className={inputCls}
        />
      </Field>

      <Field label="本文 (Markdown)" required>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending || uploading}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {uploading ? "アップロード中…" : "📷 画像を追加"}
            </button>
            <span className="text-xs text-zinc-500">
              {GUIDE_IMAGE_LABEL}、5MB 以下
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

      <Field label="タグ (カンマ区切り・最大 8)" htmlFor="qa-tags">
        <input
          id="qa-tags"
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="Claude Code, テスト, バグ"
          className={inputCls}
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || uploading || !title.trim() || !body.trim()}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending
            ? "送信中…"
            : uploading
              ? "アップロード中…"
              : mode === "create"
                ? "投稿する"
                : "更新する"}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className="ml-auto rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            削除
          </button>
        )}
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";

// Outer wrapper is `<div>`, not `<label>`: the body field contains a
// hidden `<input type="file">` alongside the Markdown editor, and a
// `<label>` outer would fire its implicit "click the first form control"
// behavior on padding clicks and pop the native file picker open. See
// the same comment in GuideForm.tsx.
//
// For a11y we render the label text as a `<label htmlFor={...}>` when an
// `htmlFor` is supplied — simple inputs get a proper screen-reader
// association, and the body field (which omits `htmlFor`) falls back to
// a plain `<span>` so the implicit-label trap stays gone.
function Field({
  label,
  required,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
          {required && <span className="text-red-600"> *</span>}
        </label>
      ) : (
        <span className="text-sm font-medium">
          {label}
          {required && <span className="text-red-600"> *</span>}
        </span>
      )}
      <div className="mt-1">{children}</div>
    </div>
  );
}
