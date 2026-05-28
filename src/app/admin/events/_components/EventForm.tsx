"use client";

import { useState, useTransition } from "react";

import {
  createEvent,
  deleteEvent,
  updateEvent,
  type EventFormInput,
} from "@/app/actions/events";
import { SaveFlash } from "@/components/forms/SaveFlash";
import type { EventDoc, SurveyField } from "@/lib/types";
import { toDate } from "@/lib/utils";

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventForm({
  mode,
  event,
}: {
  mode: "create" | "edit";
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
  const [error, setError] = useState<string | null>(null);
  // Bumped to `Date.now()` when save succeeds on the edit path —
  // updateEvent doesn't redirect, so without this the admin gets no
  // confirmation that their click did anything. See SaveFlash for the
  // visibility-timer logic.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

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
        // `redirect()` throws an internal error to trigger navigation;
        // let those propagate so Next.js can complete the redirect.
        // Anything else is a real save failure.
        const digest = (err as { digest?: unknown })?.digest;
        if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) {
          throw err;
        }
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
      <Field label="説明" required>
        <textarea
          required
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="開始日時" required>
          <input
            type="datetime-local"
            required
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="終了日時" required>
          <input
            type="datetime-local"
            required
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="形式">
        <select
          value={locationType}
          onChange={(e) => setLocationType(e.target.value as EventFormInput["locationType"])}
          className={inputCls}
        >
          <option value="offline">オフライン</option>
          <option value="online">オンライン</option>
          <option value="hybrid">ハイブリッド</option>
        </select>
      </Field>
      {(locationType === "offline" || locationType === "hybrid") && (
        <>
          <Field label="会場住所">
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="地図URL">
            <input
              type="url"
              value={mapUrl}
              onChange={(e) => setMapUrl(e.target.value)}
              className={inputCls}
            />
          </Field>
        </>
      )}
      {(locationType === "online" || locationType === "hybrid") && (
        <Field label="ミーティングURL (Zoom等)">
          <input
            type="url"
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            className={inputCls}
          />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="定員 (0=無制限)">
          <input
            type="number"
            min={0}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="発表者枠">
          <input
            type="number"
            min={0}
            value={presenterCapacity}
            onChange={(e) => setPresenterCapacity(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>
      <Field label="ステータス">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as EventFormInput["status"])}
          className={inputCls}
        >
          <option value="draft">下書き</option>
          <option value="published">公開</option>
          <option value="past">過去</option>
          <option value="cancelled">中止</option>
        </select>
      </Field>
      <Field label="公開範囲">
        <select
          value={visibility}
          onChange={(e) =>
            setVisibility(
              e.target.value as NonNullable<EventFormInput["visibility"]>,
            )
          }
          className={inputCls}
        >
          <option value="public">全員 (ログインなしでも閲覧可)</option>
          <option value="members_only">メンバー限定 (要ログイン)</option>
        </select>
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
                    className={inputCls}
                  />
                  <input
                    type="text"
                    placeholder="表示ラベル"
                    value={f.label}
                    onChange={(e) => updateField(i, { label: e.target.value })}
                    className={inputCls}
                  />
                  <select
                    value={f.type}
                    onChange={(e) =>
                      updateField(i, {
                        type: e.target.value as SurveyField["type"],
                      })
                    }
                    className={inputCls}
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
                    className={inputCls}
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
                    className={`${inputCls} mt-2`}
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

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            {pending ? "保存中..." : "保存"}
          </button>
          <SaveFlash savedAt={savedAt} />
        </div>
        {mode === "edit" && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            イベントを削除
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
