"use client";

import { useTranslations } from "next-intl";
import Image from "next/image";
import { unstable_rethrow } from "next/navigation";
import {
  deleteObject,
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useRef, useState, useTransition } from "react";

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
import {
  isProjectAsset,
  projectAssetPathSet,
  validProjectAssets,
} from "@/lib/assets";
import {
  DEFAULT_CHECKIN_EARLY_MINUTES,
  DEFAULT_CHECKIN_LATE_MINUTES,
  MAX_CHECKIN_WINDOW_MINUTES,
} from "@/lib/check-in";
import { validateSurveyFields } from "@/lib/event-survey";
import { clientStorage } from "@/lib/firebase/client";
import { publicDownloadUrl } from "@/lib/firebase/uploads";
import type {
  EventDoc,
  ProjectAsset,
  SessionUser,
  SurveyField,
} from "@/lib/types";
import {
  EVENT_TIME_ZONE_OPTIONS,
  dateToDateTimeLocal,
  eventTimeZone,
} from "@/lib/time-zones";

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

function minutesToHoursInput(
  minutes: number | undefined,
  fallbackMinutes: number,
): string {
  const hours = (minutes ?? fallbackMinutes) / 60;
  return Number.isInteger(hours)
    ? String(hours)
    : String(Number(hours.toFixed(2)));
}

function hoursInputToMinutes(value: string, fallbackMinutes: number): number {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0) return fallbackMinutes;
  return Math.min(Math.round(hours * 60), MAX_CHECKIN_WINDOW_MINUTES);
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
  const initialTimeZone = eventTimeZone(event);
  const [title, setTitle] = useState(event?.title ?? "");
  const [slug, setSlug] = useState(event?.slug ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [timeZone, setTimeZone] = useState(initialTimeZone);
  const [startAt, setStartAt] = useState(
    dateToDateTimeLocal(event?.startAt, initialTimeZone),
  );
  const [endAt, setEndAt] = useState(
    dateToDateTimeLocal(event?.endAt, initialTimeZone),
  );
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
  const [checkInEarlyHours, setCheckInEarlyHours] = useState(
    minutesToHoursInput(
      event?.checkInEarlyMinutes,
      DEFAULT_CHECKIN_EARLY_MINUTES,
    ),
  );
  const [checkInLateHours, setCheckInLateHours] = useState(
    minutesToHoursInput(event?.checkInLateMinutes, DEFAULT_CHECKIN_LATE_MINUTES),
  );
  const [fields, setFields] = useState<SurveyField[]>(event?.surveyFields ?? []);
  const initialCoverImage = isProjectAsset(event?.coverImage)
    ? event.coverImage
    : undefined;
  const initialSubImages = validProjectAssets(event?.subImages);
  const [coverImage, setCoverImage] = useState<ProjectAsset | undefined>(
    initialCoverImage,
  );
  const [subImages, setSubImages] = useState<ProjectAsset[]>(
    initialSubImages,
  );
  const [reportPostSlug, setReportPostSlug] = useState(
    event?.reportPostSlug ?? "",
  );
  const savedImagePathsRef = useRef(
    projectAssetPathSet([event?.coverImage, ...initialSubImages]),
  );
  const [coverProgress, setCoverProgress] = useState<number | null>(null);
  const [subProgress, setSubProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to `Date.now()` when save succeeds on the edit path —
  // updateEvent doesn't redirect, so without this the admin gets no
  // confirmation that their click did anything. See SaveFlash for the
  // visibility-timer logic.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("Admin.eventForm");
  const common = useTranslations("Admin.common");
  const actionErrors = useTranslations("ActionErrors");

  function uploadImage(
    file: File,
    onProgress: (pct: number) => void,
  ): Promise<ProjectAsset> {
    if (file.size > MAX_IMAGE_BYTES) {
      return Promise.reject(new Error(common("imageTooLarge", { size: 10 })));
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return Promise.reject(
        new Error(common("imageType")),
      );
    }
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    // events/{eventId-or-admin-uid}/... — the rule matches any first
    // segment with admin write, so for both create (no event id yet) and
    // edit we just root under the admin's uid and let the doc reference
    // the resulting URL.
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const path = `events/${user.uid}/${uniqueName}-${safeName}`;
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
  // (not one of the images the form was initialized with). Previously saved
  // images must stay in Storage until the admin saves the doc mutation.
  function isUnsavedUpload(path: string | undefined): boolean {
    return !!path && !savedImagePathsRef.current.has(path);
  }

  async function discardUnsavedUpload(path: string | undefined): Promise<void> {
    if (!isUnsavedUpload(path)) return;
    try {
      await deleteObject(storageRef(clientStorage, path!));
    } catch (err) {
      // Best-effort — the file might already be gone, or perms shifted.
      // Don't block the UI on this.
      console.warn("Failed to clean up unsaved event image:", err);
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
      const asset = await uploadImage(file, setCoverProgress);
      setCoverImage(asset);
    } catch (err) {
      setError(err instanceof Error ? err.message : common("uploadFailed"));
    } finally {
      setCoverProgress(null);
      e.target.value = "";
    }
  }

  async function handleSubImagesPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const uploaded: ProjectAsset[] = [];
    try {
      for (const file of files) {
        setSubProgress(0);
        const asset = await uploadImage(file, setSubProgress);
        uploaded.push(asset);
      }
      setSubImages((cur) => [...cur, ...uploaded]);
    } catch (err) {
      await Promise.all(
        uploaded.map((asset) => discardUnsavedUpload(asset.path)),
      );
      setError(err instanceof Error ? err.message : common("uploadFailed"));
    } finally {
      setSubProgress(null);
      e.target.value = "";
    }
  }

  const uploading = coverProgress !== null || subProgress !== null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Validate the questionnaire up front. An unfinished item (e.g. a
    // just-added field with no label) would otherwise fail the server's
    // Zod schema, which Next masks as the generic "Server Components
    // render" error in production — leaving the admin unable to tell why
    // the save failed (issue #102). Surface a precise inline message and
    // never send the bad payload.
    const surveyError = validateSurveyFields(fields, {
      missingKey: (index) => actionErrors("surveyMissingKey", { index }),
      duplicateKey: (index, key) =>
        actionErrors("surveyDuplicateKey", { index, key }),
      missingLabel: (index) => actionErrors("surveyMissingLabel", { index }),
      missingOption: (index) => actionErrors("surveyMissingOption", { index }),
    });
    if (surveyError) {
      setError(surveyError);
      return;
    }
    startTransition(async () => {
      try {
        const payload: EventFormInput = {
          title,
          slug: slug || undefined,
          description,
          startAt,
          endAt,
          timeZone,
          locationType,
          address,
          mapUrl,
          meetingUrl,
          capacity,
          presenterCapacity,
          status,
          visibility,
          checkInEarlyMinutes: hoursInputToMinutes(
            checkInEarlyHours,
            DEFAULT_CHECKIN_EARLY_MINUTES,
          ),
          checkInLateMinutes: hoursInputToMinutes(
            checkInLateHours,
            DEFAULT_CHECKIN_LATE_MINUTES,
          ),
          coverImage,
          subImages,
          reportPostSlug: reportPostSlug || undefined,
          surveyFields: fields,
        };
        const res =
          mode === "create"
            ? await createEvent(payload)
            : event
              ? await updateEvent(event.id, payload)
              : null;
        if (res && !res.ok) {
          // Real validation / slug-conflict message surfaced inline,
          // instead of the masked generic "Server Components render" crash.
          setError(res.error);
          return;
        }
        // Only an actual update returns here with `res.ok` (create redirects
        // via the Server Action, so it never reaches this line). Gating on
        // `res?.ok` also avoids a false saved state if `res` is null —
        // i.e. an edit somehow rendered without an `event`. Per PR #116
        // Copilot review.
        if (res?.ok) {
          savedImagePathsRef.current = projectAssetPathSet([
            payload.coverImage,
            ...(payload.subImages ?? []),
          ]);
          setSavedAt(Date.now());
        }
      } catch (err) {
        // Server-Action `redirect()` (and `notFound()`, etc.) signal
        // navigation by throwing an internal Next.js error.
        // `unstable_rethrow` is the documented way to let those
        // propagate from a try/catch — it re-throws on internal errors
        // and returns silently for anything else, which we then
        // surface as a real save failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : common("saveFailed"));
      }
    });
  }

  async function handleDelete() {
    if (!event) return;
    if (!confirm(t("deleteConfirm"))) return;
    startTransition(async () => {
      try {
        // deleteEvent redirects to /admin/events on success, so there's no
        // client-side navigation to do here.
        await deleteEvent(event.id);
      } catch (err) {
        // Success throws the internal NEXT_REDIRECT — let it propagate so
        // the navigation actually happens (mirrors handleSubmit). Anything
        // else is a real delete failure.
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : common("deleteFailed"));
      }
    });
  }

  function addField() {
    setFields((cur) => {
      // Pick the lowest `q<n>` not already in use. Seeding from the array
      // length alone repeats keys after a middle item is removed (e.g.
      // delete q2 from [q1,q2,q3] then add → another q3), and duplicate
      // keys overwrite each other's responses. Per PR #110 Gemini review.
      const used = new Set(cur.map((f) => f.key));
      let n = cur.length + 1;
      while (used.has(`q${n}`)) n++;
      return [
        ...cur,
        {
          key: `q${n}`,
          label: "",
          type: "text",
          required: false,
          audience: "all",
        },
      ];
    });
  }

  function updateField(i: number, patch: Partial<SurveyField>) {
    setFields((cur) => cur.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  function removeField(i: number) {
    setFields((cur) => cur.filter((_, idx) => idx !== i));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label={t("title")} required htmlFor="event-title">
        <input
          id="event-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label={t("slug")} htmlFor="event-slug">
        <input
          id="event-slug"
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder={t("slugPlaceholder")}
          className={inputClass}
        />
      </Field>
      <Field label={t("description")} required htmlFor="event-description">
        <textarea
          id="event-description"
          required
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label={t("timeZone")} required htmlFor="event-time-zone">
        <select
          id="event-time-zone"
          required
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value)}
          className={inputClass}
        >
          {EVENT_TIME_ZONE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(`timeZoneOption.${option.labelKey}`)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("startAt")} required htmlFor="event-start">
          <input
            id="event-start"
            type="datetime-local"
            required
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t("endAt")} required htmlFor="event-end">
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
      <div className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="space-y-1">
          <h3 className="font-semibold">{t("checkInWindowTitle")}</h3>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t("checkInWindowHelp")}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("checkInEarlyHours")}
            required
            htmlFor="event-check-in-early"
          >
            <input
              id="event-check-in-early"
              type="number"
              required
              min={0}
              max={MAX_CHECKIN_WINDOW_MINUTES / 60}
              step={0.25}
              value={checkInEarlyHours}
              onChange={(e) => setCheckInEarlyHours(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field
            label={t("checkInLateHours")}
            required
            htmlFor="event-check-in-late"
          >
            <input
              id="event-check-in-late"
              type="number"
              required
              min={0}
              max={MAX_CHECKIN_WINDOW_MINUTES / 60}
              step={0.25}
              value={checkInLateHours}
              onChange={(e) => setCheckInLateHours(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </div>
      <Field label={t("locationType")} htmlFor="event-location-type">
        <select
          id="event-location-type"
          value={locationType}
          onChange={(e) =>
            setLocationType(e.target.value as EventFormInput["locationType"])
          }
          className={inputClass}
        >
          <option value="offline">{t("location.offline")}</option>
          <option value="online">{t("location.online")}</option>
          <option value="hybrid">{t("location.hybrid")}</option>
        </select>
      </Field>
      {(locationType === "offline" || locationType === "hybrid") && (
        <>
          <Field label={t("address")} htmlFor="event-address">
            <input
              id="event-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={t("mapUrl")} htmlFor="event-map-url">
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
        <Field label={t("meetingUrl")} htmlFor="event-meeting-url">
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
        <Field label={t("capacity")} htmlFor="event-capacity">
          <input
            id="event-capacity"
            type="number"
            min={0}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t("presenterCapacity")} htmlFor="event-presenter-capacity">
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
      <Field label={t("status")} htmlFor="event-status">
        <select
          id="event-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as EventFormInput["status"])}
          className={inputClass}
        >
          <option value="draft">{t("statusOption.draft")}</option>
          <option value="published">{t("statusOption.published")}</option>
          <option value="past">{t("statusOption.past")}</option>
          <option value="cancelled">{t("statusOption.cancelled")}</option>
        </select>
      </Field>
      <Field label={t("visibility")} htmlFor="event-visibility">
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
          <option value="public">{t("visibilityOption.public")}</option>
          <option value="members_only">{t("visibilityOption.members_only")}</option>
        </select>
      </Field>
      <Field
        label={t("reportPostSlug")}
        htmlFor="event-report-post-slug"
        hint={t("reportPostSlugHint")}
      >
        <input
          id="event-report-post-slug"
          type="text"
          value={reportPostSlug}
          onChange={(e) => setReportPostSlug(e.target.value)}
          placeholder={t("reportPostSlugPlaceholder")}
          className={inputClass}
        />
      </Field>

      <Field label={t("cover")}>
        <div className="space-y-2">
          {coverImage && (
            <div className="flex items-center gap-3">
              <Image
                src={coverImage.url}
                alt={t("coverPreviewAlt", {
                  title: title || t("coverFallbackTitle"),
                })}
                width={160}
                height={96}
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
                {common("delete")}
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
              {common("uploadWithProgress", {
                progress: coverProgress.toFixed(0),
              })}
            </p>
          )}
        </div>
      </Field>

      <Field label={t("subImages")}>
        <div className="space-y-3">
          {subImages.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {subImages.map((image, i) => (
                <li key={image.path} className="space-y-2">
                  <Image
                    src={image.url}
                    alt={t("subImagePreviewAlt", {
                      index: i + 1,
                      title: title || t("coverFallbackTitle"),
                    })}
                    width={320}
                    height={240}
                    className="aspect-[4/3] w-full rounded border border-zinc-200 object-cover dark:border-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      await discardUnsavedUpload(image.path);
                      setSubImages((cur) =>
                        cur.filter((_, idx) => idx !== i),
                      );
                    }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    {common("delete")}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            type="file"
            accept={ACCEPT}
            multiple
            disabled={pending || uploading}
            onChange={handleSubImagesPick}
            className="block w-full text-sm disabled:opacity-50"
          />
          {subProgress !== null && (
            <p className="text-xs text-zinc-500">
              {common("uploadWithProgress", {
                progress: subProgress.toFixed(0),
              })}
            </p>
          )}
        </div>
      </Field>

      <div className="space-y-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{t("surveyTitle")}</h3>
          <button
            type="button"
            onClick={addField}
            className="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
          >
            {t("addSurveyField")}
          </button>
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-zinc-500">{common("none")}</p>
        ) : (
          <ul className="space-y-3">
            {fields.map((f, i) => (
              <li key={i} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder={t("keyPlaceholder")}
                    value={f.key}
                    onChange={(e) => updateField(i, { key: e.target.value })}
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder={t("labelPlaceholder")}
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
                    <option value="text">{t("fieldType.text")}</option>
                    <option value="textarea">{t("fieldType.textarea")}</option>
                    <option value="select">{t("fieldType.select")}</option>
                    <option value="checkbox">{t("fieldType.checkbox")}</option>
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
                    <option value="all">{t("audience.all")}</option>
                    <option value="presenter">{t("audience.presenter")}</option>
                  </select>
                </div>
                {f.type === "select" && (
                  <input
                    type="text"
                    placeholder={t("optionsPlaceholder")}
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
                    {t("required")}
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    {common("delete")}
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
            {pending ? common("saving") : uploading ? common("uploading") : common("save")}
          </button>
          <SaveFlash savedAt={savedAt} message={common("saved")} />
        </div>
        {mode === "edit" && (
          <button
            type="button"
            onClick={handleDelete}
            className={dangerButtonClass}
          >
            {t("deleteEvent")}
          </button>
        )}
      </div>
    </form>
  );
}
