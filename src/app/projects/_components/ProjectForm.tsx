"use client";

import {
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useState, useTransition } from "react";

import { submitProject, updateMyProject } from "@/app/actions/projects";
import { Field } from "@/components/forms/Field";
import {
  errorTextClass,
  inputClass,
  primaryButtonClass,
} from "@/components/forms/styles";
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

interface Props {
  mode: "create" | "edit";
  user: SessionUser;
  project?: ProjectDoc;
}

export function ProjectForm({ mode, user, project }: Props) {
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      setError(err instanceof Error ? err.message : "アップロード失敗");
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
      setError(`スクリーンショットは最大 ${MAX_SCREENSHOTS} 枚までです`);
      return;
    }
    const toUpload = files.slice(0, remaining);
    for (const file of toUpload) {
      try {
        setShotProgress(0);
        const asset = await uploadOne(file, setShotProgress);
        setScreenshots((cur) => [...cur, asset]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "アップロード失敗");
        setShotProgress(null);
        e.target.value = "";
        return;
      }
    }
    setShotProgress(null);
    e.target.value = "";
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
        if (mode === "create") {
          await submitProject(payload);
        } else if (project) {
          await updateMyProject(project.id, payload);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "送信に失敗しました");
      }
    });
  }

  const uploading = thumbProgress !== null || shotProgress !== null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="タイトル" required htmlFor="project-title">
        <input
          id="project-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="説明 (Markdown可)" required htmlFor="project-description">
        <textarea
          id="project-description"
          required
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="タグ (カンマ区切り)" htmlFor="project-tags">
        <input
          id="project-tags"
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="LLM, RAG, Agent"
          className={inputClass}
        />
      </Field>
      <Field label="アプリのURL (任意)" htmlFor="project-app-url">
        <input
          id="project-app-url"
          type="url"
          value={appUrl}
          onChange={(e) => setAppUrl(e.target.value)}
          placeholder="https://your-app.example.com (CLI / ローカル専用なら空欄でOK)"
          className={inputClass}
        />
      </Field>
      <Field label="リポジトリURL" htmlFor="project-repo-url">
        <input
          id="project-repo-url"
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="デモ動画URL (YouTube等)" htmlFor="project-demo-url">
        <input
          id="project-demo-url"
          type="url"
          value={demoVideoUrl}
          onChange={(e) => setDemoVideoUrl(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="カバー画像 (一覧のサムネ用・1枚・5MBまで)">
        <div className="space-y-2">
          {thumbnail && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnail.url}
                alt="thumbnail preview"
                className="h-20 w-20 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
              <button
                type="button"
                onClick={() => setThumbnail(undefined)}
                className="text-xs text-red-600 hover:underline"
              >
                削除
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
              アップロード中… {thumbProgress.toFixed(0)}%
            </p>
          )}
        </div>
      </Field>

      <Field label={`スクリーンショット (最大 ${MAX_SCREENSHOTS} 枚・各 5MBまで)`}>
        <div className="space-y-2">
          {screenshots.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {screenshots.map((s, i) => (
                <li key={s.path} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.url}
                    alt={`screenshot ${i + 1}`}
                    className="h-24 w-full rounded border border-zinc-200 object-cover dark:border-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={() => removeScreenshot(i)}
                    className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-black/80"
                  >
                    削除
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
              アップロード中… {shotProgress.toFixed(0)}%
            </p>
          )}
          <p className="text-xs text-zinc-500">
            {screenshots.length} / {MAX_SCREENSHOTS} 枚
          </p>
        </div>
      </Field>

      {error && <p className={errorTextClass}>{error}</p>}
      {mode === "edit" && (
        <p className="text-xs text-zinc-500">
          編集すると再度「審査中」となり、管理者の承認後に再掲載されます。
        </p>
      )}

      <button
        type="submit"
        disabled={pending || uploading}
        className={primaryButtonClass}
      >
        {pending
          ? "送信中..."
          : uploading
            ? "アップロード中..."
            : mode === "create"
              ? "投稿して審査依頼"
              : "更新して再審査"}
      </button>
    </form>
  );
}

