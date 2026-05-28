"use client";

import { unstable_rethrow } from "next/navigation";
import {
  deleteObject,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useState, useTransition } from "react";

import {
  createEvent,
  deleteEvent,
  updateEvent,
  type EventFormInput,
} from "@/app/actions/events";
import { Field } from "@/components/forms/Field";
import { SaveFlash } from "@/components/forms/SaveFlash";
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  primaryButtonClass,
} from "@/components/forms/styles";
import { clientStorage } from "@/lib/firebase/client";
import { publicDownloadUrl } from "@/lib/firebase/uploads";
import type {
  EventDoc,
  ProjectAsset,
  SessionUser,
  SurveyField,
} from "@/lib/types";
import { toDate } from "@/lib/utils";

// Matches the events/{eventId}/{**} storage rule (admin write, image only,
// 10MB cap). Cover images get a slightly larger budget than project /
// post thumbnails because they're the hero asset on /events cards.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
const ACCEPT = ALLOWED_MIME.join(",");

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventForm({
  mode,
  user,
  event,
}: {
  mode: "create" | "edit";
  user: SessionUser;
  event?: EventDoc;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [slug, setSlug] = useState(event?.slug ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startAt, setStartAt] = useState(toLocalInput(toDate(event?.startAt)));
  const [endAt, setEndAt] = useState(toLocalInput(toDate(event?.endAt)));
  const [locationType, setLocationType] = useState<EventFormInput["locationType"]>(
    event?.location.type ?? "offline",
  );
  const [address, setAddress] = useState(event?.location.address ?? "");
  const [mapUrl, setMapUrl] = useState(event?.location.mapUrl ?? "");
  const [meetingUrl, setMeetingUrl] = useState(event?.location.meetingUrl ?? "");
  const [capacity, setCapacity] = useState(String(event?.capacity ?? 0));
  const [presenterCapacity, setPresenterCapacity] = useState(
    String(event?.presenterCapacity ?? 0),
  );
  const [status, setStatus] = useState<EventFormInput["status"]>(
    event?.status ?? "draft",
  );
  const [visibility, setVisibility] = useState<
    NonNullable<EventFormInput["visibility"]>
  >(event?.visibility ?? "public");
  const [fields, setFields] = useState<SurveyField[]>(event?.surveyFields ?? []);
  const [coverImage, setCoverImage] = useState<ProjectAsset | undefined>(
    event?.coverImage,
  );
  const [coverProgress, setCoverProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to `Date.now()` when save succeeds on the edit path —
  // updateEvent doesn't redirect, so without this the admin gets no
  // confirmation that their click did anything. See SaveFlash for the
  // visibility-timer logic.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  function uploadCover(
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<ProjectAsset> {
    if (file.size > MAX_IMAGE_BYTES) {
      return Promise.reject(new Error("画像サイズは 10MB 以下にしてください"));
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return Promise.reject(
        new Error("PNG / JPEG / WebP / GIF のいずれかを選択してください"),
      );
    }
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    // events/{eventId-or-admin-uid}/... — the rule matches any first
    // segment with admin write, so for both create (no event id yet) and
    // edit we just root under the admin's uid and let the doc reference
    // the resulting URL.
    const path = `events/${user.uid}/${Date.now()}-${safeName}`;
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
          // events/{...} has `allow read: if true` in storage.rules, so
          // build a token-less public URL from the upload ref instead of
          // calling getDownloadURL(). Skips a round-trip and avoids
          // persisting a Storage access token into Firestore — same
          // pattern as PostForm / ProjectForm (PR #47).
          resolve({ path, url: publicDownloadUrl(task.snapshot.ref) });
        },
      );
    });
  }

  // True if the path on the current state was uploaded during this session
  // (different from whatever the form was initialized with). The previous
  // image lives only because the picker eagerly uploads; if the user
  // replaces or deletes it without saving, we should drop the orphaned
  // Storage object instead of relying on a hypothetical cleanup cron.
  function isUnsavedUpload(path: string | undefined): boolean {
    return !!path && path !== event?.coverImage?.path;
  }

  async function discardUnsavedUpload(path: string | undefined): Promise<void> {
    if (!isUnsavedUpload(path)) return;
    try {
      await deleteObject(storageRef(clientStorage, path!));
    } catch (err) {
      // Best-effort — the file might already be gone, or perms shifted.
      // Don't block the UI on this.
      console.warn("Failed to clean up unsaved cover image:", err);
    }
  }

  async function handleCoverPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setCoverProgress(0);
      // Replacing an unsaved upload: drop the previous file first so we
      // don't leak a Storage object the doc never references.
      await discardUnsavedUpload(coverImage?.path);
      const asset = await uploadCover(file, setCoverProgress);
      setCoverImage(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : "アップロード失敗");
    } finally {
      setCoverProgress(null);
      e.target.value = "";
    }
  }

  const uploading = coverProgress !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const payload: EventFormInput = {
          title,
          slug: slug || undefined,
          description,
          startAt,
          endAt,
          locationType,
          address,
          mapUrl,
          meetingUrl,
          capacity,
          presenterCapacity,
          status,
          visibility,
          coverImage,
          surveyFields: fields,
        };
        if (mode === "create") {
          await createEvent(payload);
        } else if (event) {
          await updateEvent(event.id, payload);
        }
        // Update path doesn't redirect (admin stays on /admin/events/
        // [id]/edit); surface explicit "✓ 保存しました" feedback so the
        // click feels acknowledged. Create path redirects via the
        // Server Action, so this line only ever observably runs on
        // update.
        setSavedAt(Date.now());
      } catch (err) {
        // Server-Action `redirect()` (and `notFound()`, etc.) signal
        // navigation by throwing an internal Next.js error.
        // `unstable_rethrow` is the documented way to let those
        // propagate from a try/catch — it re-throws on internal errors
        // and returns silently for anything else, which we then
        // surface as a real save failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : "保存に失敗しました");
      }
    });
  }

  async function handleDelete() {
    if (!event) return;
    if (!confirm("このイベントを削除しますか？")) return;
    startTransition(async () => {
      try {
        await deleteEvent(event.id);
        window.location.href = "/admin/events";
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  function addField() {
    setFields((cur) => [
      ...cur,
      {
        key: `q${cur.length + 1}`,
        label: "",
        type: "text",
        required: false,
        audience: "all",
      },
    ]);
  }

  function updateField(i: number, patch: Partial<SurveyField>) {
    setFields((cur) => cur.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function removeField(i: number) {
    setFields((cur) => cur.filter((_, idx) => idx !== i));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="タイトル" required htmlFor="event-title">
        <input
          id="event-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="スラッグ (URL)" htmlFor="event-slug">
        <input
          id="event-slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="自動生成 (英小文字/数字/ハイフン)"
          className={inputClass}
        />
      </Field>
      <Field label="説明" required htmlFor="event-description">
        <textarea
          id="event-description"
          required
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="開始日時" required htmlFor="event-start">
          <input
            id="event-start"
            type="datetime-local"
            required
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="終了日時" required htmlFor="event-end">
          <input
            id="event-end"
            type="datetime-local"
            required
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="形式" htmlFor="event-location-type">
        <select
          id="event-location-type"
          value={locationType}
          onChange={(e) => setLocationType(e.target.value as EventFormInput["locationType"])}
          className={inputClass}
        >
          <option value="offline">オフライン</option>
          <option value="online">オンライン</option>
          <option value="hybrid">ハイブリッド</option>
        </select>
      </Field>
      {(locationType === "offline" || locationType === "hybrid") && (
        <>
          <Field label="会場住所" htmlFor="event-address">
            <input
              id="event-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="地図URL" htmlFor="event-map-url">
            <input
              id="event-map-url"
              type="url"
              value={mapUrl}
              onChange={(e) => setMapUrl(e.target.value)}
              className={inputClass}
            />
          </Field>
        </>
      )}
      {(locationType === "online" || locationType === "hybrid") && (
        <Field label="ミーティングURL (Zoom等)" htmlFor="event-meeting-url">
          <input
            id="event-meeting-url"
            type="url"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            className={inputClass}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="定員 (0=無制限)" htmlFor="event-capacity">
          <input
            id="event-capacity"
            type="number"
            min={0}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="発表者枠" htmlFor="event-presenter-capacity">
          <input
            id="event-presenter-capacity"
            type="number"
            min={0}
            value={presenterCapacity}
            onChange={(e) => setPresenterCapacity(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <Field label="ステータス" htmlFor="event-status">
        <select
          id="event-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as EventFormInput["status"])}
          className={inputClass}
        >
          <option value="draft">下書き</option>
          <option value="published">公開</option>
          <option value="past">過去</option>
          <option value="cancelled">中止</option>
        </select>
      </Field>
      <Field label="公開範囲" htmlFor="event-visibility">
        <select
          id="event-visibility"
          value={visibility}
          onChange={(e) =>
            setVisibility(
              e.target.value as NonNullable<EventFormInput["visibility"]>,
            )
          }
          className={inputClass}
        >
          <option value="public">全員 (ログインなしでも閲覧可)</option>
          <option value="members_only">メンバー限定 (要ログイン)</option>
        </select>
      </Field>

      <Field label="カバー画像 (任意・10MBまで・PNG/JPEG/WebP/GIF)">
        <div className="space-y-2">
          {coverImage && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverImage.url}
                alt={`${title || "イベント"} のカバー画像プレビュー`}
                className="h-24 w-40 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
              <button
                type="button"
                onClick={async () => {
                  // Same orphan-cleanup as replace: if this image was
                  // uploaded during the current session and the user is
                  // backing out of it, drop the Storage object now. The
                  // original saved image (if any) stays in Storage and
                  // gets cleaned up server-side when the form submits.
                  await discardUnsavedUpload(coverImage.path);
                  setCoverImage(undefined);
                }}
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

      <div className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">アンケート項目</h3>
          <button
            type="button"
            onClick={addField}
            className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
          >
            + 項目を追加
          </button>
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-zinc-500">なし</p>
        ) : (
          <ul className="space-y-3">
            {fields.map((f, i) => (
              <li key={i} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="key (英数字)"
                    value={f.key}
                    onChange={(e) => updateField(i, { key: e.target.value })}
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="表示ラベル"
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    className={inputClass}
                  />
                  <select
                    value={f.type}
                    onChange={(e) =>
                      updateField(i, {
                        type: e.target.value as SurveyField["type"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="text">テキスト</option>
                    <option value="textarea">複数行</option>
                    <option value="select">選択肢</option>
                    <option value="checkbox">チェックボックス</option>
                  </select>
                  <select
                    value={f.audience}
                    onChange={(e) =>
                      updateField(i, {
                        audience: e.target.value as SurveyField["audience"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="all">全員</option>
                    <option value="presenter">発表者のみ</option>
                  </select>
                </div>
                {f.type === "select" && (
                  <input
                    type="text"
                    placeholder="選択肢 (カンマ区切り)"
                    value={f.options?.join(", ") ?? ""}
                    onChange={(e) =>
                      updateField(i, {
                        options: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className={`${inputClass} mt-2`}
                  />
                )}
                <div className="mt-2 flex items-center justify-between">
                  <label className="text-sm">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked })}
                    />{" "}
                    必須
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className={errorTextClass}>{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending || uploading}
            className={primaryButtonClass}
          >
            {pending ? "保存中..." : uploading ? "アップロード中..." : "保存"}
          </button>
          <SaveFlash savedAt={savedAt} />
        </div>
        {mode === "edit" && (
          <button
            type="button"
            onClick={handleDelete}
            className={dangerButtonClass}
          >
            イベントを削除
          </button>
        )}
      </div>
    </form>
  );
}

