"use client";

import {
  getDownloadURL,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useState, useTransition } from "react";

import {
  deletePresentation,
  savePresentation,
} from "@/app/actions/presentations";
import { clientStorage } from "@/lib/firebase/client";
import type { PresentationDoc, RsvpDoc, SessionUser } from "@/lib/types";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // matches storage.rules

type UploadMode = "file" | "url";

export function PresentationSection({
  eventId,
  eventSlug,
  user,
  myRsvp,
  initialPresentations,
}: {
  eventId: string;
  eventSlug: string;
  user: SessionUser | null;
  myRsvp: RsvpDoc | null;
  initialPresentations: PresentationDoc[];
}) {
  const [presentations, setPresentations] =
    useState<PresentationDoc[]>(initialPresentations);
  const [mode, setMode] = useState<UploadMode>("file");
  const [externalUrl, setExternalUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canPresent =
    !!user && myRsvp?.role === "presenter" && myRsvp?.status === "confirmed";
  const mine = user ? presentations.find((p) => p.presenterUid === user.uid) : null;

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) return;

    if (mode === "url") {
      if (!externalUrl.trim()) {
        setError("URL を入力してください");
        return;
      }
      startTransition(async () => {
        try {
          const saved = await savePresentation({
            eventId,
            eventSlug,
            externalSlidesUrl: externalUrl.trim(),
          });
          setPresentations((cur) => upsertPresentation(cur, saved));
          setExternalUrl("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "保存に失敗しました");
        }
      });
      return;
    }

    // File upload path
    if (!file) {
      setError("ファイルを選択してください");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("ファイルサイズは 50MB 以下にしてください");
      return;
    }

    // Stable storage path per presenter; replacing the file keeps the same
    // path so old downloads can be retired in one shot.
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    const path = `presentations/${eventId}/${user.uid}/${Date.now()}-${safeName}`;
    const objectRef = storageRef(clientStorage, path);

    setProgress(0);
    const task = uploadBytesResumable(objectRef, file, {
      contentType: file.type || "application/octet-stream",
    });
    task.on(
      "state_changed",
      (snap) => {
        setProgress((snap.bytesTransferred / snap.totalBytes) * 100);
      },
      (err) => {
        setError(`アップロード失敗: ${err.message}`);
        setProgress(null);
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          const saved = await savePresentation({
            eventId,
            eventSlug,
            filePath: path,
            fileUrl: downloadUrl,
            fileName: safeName,
          });
          setPresentations((cur) => upsertPresentation(cur, saved));
          setFile(null);
          setProgress(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "保存に失敗しました");
          setProgress(null);
        }
      },
    );
  }

  async function handleDelete() {
    if (!confirm("発表資料を削除しますか？")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deletePresentation({ eventId, eventSlug });
        setPresentations((cur) =>
          cur.filter((p) => p.presenterUid !== user!.uid),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-xl font-semibold mb-4">発表資料</h2>

      {presentations.length === 0 ? (
        <p className="text-sm text-zinc-500">まだ発表資料は登録されていません。</p>
      ) : (
        <ul className="space-y-3">
          {presentations.map((p) => (
            <li
              key={p.id}
              className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.title || "(タイトル未設定)"}</p>
                  <p className="text-xs text-zinc-500">{p.presenterName}</p>
                  {p.abstract && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
                      {p.abstract}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
                  {p.fileUrl && (
                    <a
                      href={p.fileUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-blue-600 hover:underline"
                    >
                      ファイルを開く
                    </a>
                  )}
                  {p.externalSlidesUrl && (
                    <a
                      href={p.externalSlidesUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-blue-600 hover:underline"
                    >
                      外部リンク
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canPresent && (
        <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 className="mb-3 text-sm font-semibold">
            {mine ? "発表資料を差し替え" : "発表資料をアップロード"}
          </h3>
          <form onSubmit={handleUpload} className="space-y-3">
            <div className="flex gap-3 text-sm">
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="upload-mode"
                  value="file"
                  checked={mode === "file"}
                  onChange={() => setMode("file")}
                />
                ファイル (最大 50MB)
              </label>
              <label className="inline-flex items-center gap-1">
                <input
                  type="radio"
                  name="upload-mode"
                  value="url"
                  checked={mode === "url"}
                  onChange={() => setMode("url")}
                />
                外部URL (Google Slides 等)
              </label>
            </div>

            {mode === "file" ? (
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                accept=".pdf,.ppt,.pptx,.key,.odp,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                className="block w-full text-sm"
              />
            ) : (
              <input
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://docs.google.com/presentation/..."
                className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            )}

            {progress !== null && (
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                アップロード中… {progress.toFixed(0)}%
              </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending || progress !== null}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {progress !== null
                  ? "アップロード中..."
                  : pending
                    ? "保存中..."
                    : mine
                      ? "差し替えて保存"
                      : "保存"}
              </button>
              {mine && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={pending}
                  className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
                >
                  削除
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500">
              タイトル・概要は参加登録時に入力したものが使われます。変更したい場合は参加登録フォームで更新してください。
            </p>
          </form>
        </div>
      )}
    </section>
  );
}

function upsertPresentation(
  list: PresentationDoc[],
  next: PresentationDoc,
): PresentationDoc[] {
  const i = list.findIndex((p) => p.id === next.id);
  if (i === -1) return [...list, next];
  const copy = list.slice();
  copy[i] = next;
  return copy;
}
