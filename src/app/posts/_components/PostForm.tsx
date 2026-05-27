"use client";

import dynamic from "next/dynamic";
import {
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useEffect, useState, useTransition } from "react";

import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  deleteMyPost,
  submitPost,
  updateMyPost,
  type PostFormInput,
} from "@/app/actions/posts";
import { clientStorage } from "@/lib/firebase/client";
import type { PostDoc, ProjectAsset, SessionUser } from "@/lib/types";

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
// `タグA、タグB，タグC` works alongside `tagA, tagB`.
function stringToTags(s: string): string[] {
  return s
    .split(/[,、，]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function tagsToString(tags: string[]): string {
  return tags.join(", ");
}

interface Props {
  mode: "create" | "edit";
  user: SessionUser;
  post?: PostDoc;
}

export function PostForm({ mode, user, post }: Props) {
  const [title, setTitle] = useState(post?.title ?? "");
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? "");
  const [body, setBody] = useState<string>(post?.body ?? "");
  const [tagsInput, setTagsInput] = useState(
    tagsToString(post?.tags ?? []),
  );
  const [coverImage, setCoverImage] = useState<ProjectAsset | undefined>(
    post?.coverImage,
  );
  const [coverProgress, setCoverProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      return Promise.reject(new Error("画像サイズは 5MB 以下にしてください"));
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return Promise.reject(
        new Error("PNG / JPEG / WebP / GIF のいずれかを選択してください"),
      );
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
        async () => {
          try {
            const url = await getDownloadURL(task.snapshot.ref);
            resolve({ path, url });
          } catch (err) {
            reject(err);
          }
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
      setError(err instanceof Error ? err.message : "アップロード失敗");
    } finally {
      setCoverProgress(null);
      e.target.value = "";
    }
  }

  function submit(intent: "draft" | "pending") {
    setError(null);
    startTransition(async () => {
      try {
        const payload: PostFormInput = {
          title,
          excerpt,
          body,
          tags: stringToTags(tagsInput),
          coverImage,
          intent,
        };
        if (mode === "create") {
          await submitPost(payload);
        } else if (post) {
          await updateMyPost(post.id, payload);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存に失敗しました");
      }
    });
  }

  async function handleDelete() {
    if (!post) return;
    if (!confirm("この記事を削除しますか？")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteMyPost(post.id);
        window.location.href = "/my/posts";
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  const uploading = coverProgress !== null;

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
      <Field label="タイトル" required>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputCls}
        />
      </Field>

      <Field label="抜粋 (一覧表示用・最大 300 字)" required>
        <textarea
          required
          rows={2}
          maxLength={300}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          className={inputCls}
        />
        <p className="mt-1 text-xs text-zinc-500">{excerpt.length} / 300</p>
      </Field>

      <Field label="本文 (Markdown)" required>
        <div data-color-mode={colorMode}>
          <MDEditor
            value={body}
            onChange={(v) => setBody(v ?? "")}
            height={500}
            preview="live"
          />
        </div>
      </Field>

      <Field label="タグ (カンマ区切り・最大 8)">
        <input
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="お知らせ、勉強会, レポート"
          className={inputCls}
        />
      </Field>

      <Field label="カバー画像 (任意・5MB まで)">
        <div className="space-y-2">
          {coverImage && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverImage.url}
                alt="cover preview"
                className="h-20 w-32 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
              <button
                type="button"
                onClick={() => setCoverImage(undefined)}
                className="text-xs text-red-600 hover:underline"
              >
                削除
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
              アップロード中… {coverProgress.toFixed(0)}%
            </p>
          )}
        </div>
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mode === "edit" && !user.isAdmin && (
        <p className="text-xs text-zinc-500">
          編集すると再度「審査中」となり、管理者の承認後に再掲載されます。
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || uploading}
          onClick={() => submit("draft")}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          下書き保存
        </button>
        <button
          type="submit"
          disabled={pending || uploading}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending
            ? "送信中..."
            : uploading
              ? "アップロード中..."
              : mode === "create"
                ? "投稿して審査依頼"
                : "更新して再審査"}
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
