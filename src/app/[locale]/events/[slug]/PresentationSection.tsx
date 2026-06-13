"use client";

import {
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  createPresentation,
  deletePresentation,
  updatePresentation,
} from "@/app/actions/presentations";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import type { PublicProfile } from "@/lib/data/users";
import { clientStorage } from "@/lib/firebase/client";
import { publicDownloadUrl } from "@/lib/firebase/uploads";
import type { PresentationDoc, RsvpDoc, SessionUser } from "@/lib/types";

const MAX_FILE_BYTES = 50 * 1024 * 1024; // matches storage.rules

// Draft state shared between "new" and "edit" forms. A draft can hold an
// existing uploaded file (from a prior save) plus a freshly picked file
// that hasn't been uploaded yet; submit time decides which to use.
interface Draft {
  title: string;
  abstract: string;
  filePath?: string;
  fileUrl?: string;
  fileName?: string;
  externalSlidesUrl: string;
}

function emptyDraft(): Draft {
  return { title: "", abstract: "", externalSlidesUrl: "" };
}

function draftFrom(p: PresentationDoc): Draft {
  return {
    title: p.title,
    abstract: p.abstract ?? "",
    filePath: p.filePath,
    fileUrl: p.fileUrl,
    fileName: p.fileName,
    externalSlidesUrl: p.externalSlidesUrl ?? "",
  };
}

export function PresentationSection({
  eventId,
  eventSlug,
  user,
  myRsvp,
  initialPresentations,
  presenterProfiles,
}: {
  eventId: string;
  eventSlug: string;
  user: SessionUser | null;
  myRsvp: RsvpDoc | null;
  initialPresentations: PresentationDoc[];
  // Prefetched on the server so each row can show the presenter's
  // current @username without hitting Firestore per row. Plain object
  // (not Map) so the prop survives the RSC→Client serialization.
  presenterProfiles: Record<string, PublicProfile>;
}) {
  const t = useTranslations("Presentations");
  const canPresent =
    !!user && myRsvp?.role === "presenter" && myRsvp?.status === "confirmed";
  const [presentations, setPresentations] =
    useState<PresentationDoc[]>(initialPresentations);
  const [editingId, setEditingId] = useState<string | "new" | null>(
    canPresent && initialPresentations.length === 0 ? "new" : null,
  );

  function applyUpsert(saved: PresentationDoc) {
    setPresentations((cur) => {
      const i = cur.findIndex((p) => p.id === saved.id);
      if (i === -1) return [...cur, saved];
      const copy = cur.slice();
      copy[i] = saved;
      return copy;
    });
  }

  function applyDelete(id: string) {
    setPresentations((cur) => cur.filter((p) => p.id !== id));
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        {canPresent && editingId === null && (
          <button
            type="button"
            onClick={() => setEditingId("new")}
            className="rounded-md bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t("add")}
          </button>
        )}
      </div>

      {presentations.length === 0 && editingId !== "new" && (
        <div className="space-y-1 text-sm text-zinc-500">
          <p>{t("empty")}</p>
          {!canPresent && (
            <p className="text-xs">
              {user ? t("presenterOnlyHelp") : t("loginToAddHelp")}
            </p>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {presentations.map((p) => {
          const owned = !!user && p.presenterUid === user.uid;
          if (editingId === p.id) {
            return (
              <li key={p.id}>
                <PresentationForm
                  mode="edit"
                  initial={draftFrom(p)}
                  eventId={eventId}
                  eventSlug={eventSlug}
                  uid={user!.uid}
                  presentationId={p.id}
                  onSaved={(saved) => {
                    applyUpsert(saved);
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                  onDelete={() => {
                    applyDelete(p.id);
                    setEditingId(null);
                  }}
                />
              </li>
            );
          }
          return (
            <li
              key={p.id}
              className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{p.title || t("untitled")}</p>
                  {/*
                    AuthorBadge instead of a raw `@username` so role
                    pills and opted-in real names show up here. Each
                    list entry already wraps its own action affordances
                    so the badge is rendered as a non-link (the
                    presenter's profile is reachable from the byline
                    on every other surface).
                  */}
                  <p className="text-xs text-zinc-500">
                    <AuthorBadge
                      profile={presenterProfiles[p.presenterUid] ?? null}
                      linkable={false}
                    />
                  </p>
                  {p.abstract && (
                    <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
                      {p.abstract}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {p.fileUrl && (
                      <a
                        href={p.fileUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-blue-600 hover:underline"
                      >
                        📎 {p.fileName || t("openFile")}
                      </a>
                    )}
                    {p.externalSlidesUrl && (
                      <a
                        href={p.externalSlidesUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-blue-600 hover:underline"
                      >
                        🔗 {t("externalLink")}
                      </a>
                    )}
                  </div>
                </div>
                {owned && editingId === null && (
                  <button
                    type="button"
                    onClick={() => setEditingId(p.id)}
                    className="shrink-0 text-xs text-blue-600 hover:underline"
                  >
                    {t("edit")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {canPresent && editingId === "new" && (
        <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <PresentationForm
            mode="create"
            initial={emptyDraft()}
            eventId={eventId}
            eventSlug={eventSlug}
            uid={user!.uid}
            onSaved={(saved) => {
              applyUpsert(saved);
              setEditingId(null);
            }}
            onCancel={() => setEditingId(null)}
          />
        </div>
      )}
    </section>
  );
}

// -------- form (used for both create and edit) --------

function PresentationForm({
  mode,
  initial,
  eventId,
  eventSlug,
  uid,
  presentationId,
  onSaved,
  onCancel,
  onDelete,
}: {
  mode: "create" | "edit";
  initial: Draft;
  eventId: string;
  eventSlug: string;
  uid: string;
  presentationId?: string;
  onSaved: (saved: PresentationDoc) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations("Presentations");
  const [draft, setDraft] = useState<Draft>(initial);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Effective file fields = freshly staged upload, else whatever's already
  // on the doc. Used for validation + the eventual save payload.
  const hasFile = !!stagedFile || !!draft.filePath;
  const hasUrl = !!draft.externalSlidesUrl.trim();

  async function uploadIfNeeded(): Promise<Pick<
    Draft,
    "filePath" | "fileUrl" | "fileName"
  > | null> {
    if (!stagedFile) {
      return {
        filePath: draft.filePath,
        fileUrl: draft.fileUrl,
        fileName: draft.fileName,
      };
    }
    if (stagedFile.size > MAX_FILE_BYTES) {
      throw new Error(t("fileTooLarge"));
    }
    const safeName = stagedFile.name.replace(/[^\p{L}\p{N}._-]+/gu, "_");
    const path = `presentations/${eventId}/${uid}/${Date.now()}-${safeName}`;
    const objectRef = storageRef(clientStorage, path);
    setProgress(0);
    return new Promise((resolve, reject) => {
      const task = uploadBytesResumable(objectRef, stagedFile, {
        contentType: stagedFile.type || "application/octet-stream",
      });
      task.on(
        "state_changed",
        (snap) =>
          setProgress((snap.bytesTransferred / snap.totalBytes) * 100),
        (err) => {
          setProgress(null);
          reject(err);
        },
        () => {
          // presentations/{eventId}/{uid}/ is publicly readable per
          // storage.rules; build the URL from the ref instead of doing a
          // second round-trip to fetch a token. See uploads.ts.
          setProgress(null);
          resolve({
            filePath: path,
            fileUrl: publicDownloadUrl(task.snapshot.ref),
            fileName: safeName,
          });
        },
      );
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!draft.title.trim()) {
      setError(t("titleRequired"));
      return;
    }
    if (!hasFile && !hasUrl) {
      setError(t("fileOrUrlRequired"));
      return;
    }

    let fileFields: Pick<Draft, "filePath" | "fileUrl" | "fileName"> | null;
    try {
      fileFields = await uploadIfNeeded();
    } catch (err) {
      setError(
        err instanceof Error
          ? t("uploadFailedWithMessage", { message: err.message })
          : t("uploadFailed"),
      );
      return;
    }

    startTransition(async () => {
      try {
        const payload = {
          eventId,
          eventSlug,
          title: draft.title.trim(),
          abstract: draft.abstract.trim() || undefined,
          filePath: fileFields?.filePath,
          fileUrl: fileFields?.fileUrl,
          fileName: fileFields?.fileName,
          externalSlidesUrl: draft.externalSlidesUrl.trim() || undefined,
        };
        const result =
          mode === "create"
            ? await createPresentation(payload)
            : await updatePresentation({
                ...payload,
                presentationId: presentationId!,
              });
        if (result.ok) {
          onSaved(result.presentation);
        } else {
          // Validation / permission problems come back as a readable
          // message here instead of a thrown error, which Next would
          // otherwise mask as the generic "Server Components render"
          // crash in production (issue #103).
          setError(result.error);
        }
      } catch (err) {
        // Only unexpected failures reach here now (e.g. an expired
        // session throwing in requireUser, or a network blip).
        setError(err instanceof Error ? err.message : t("saveFailed"));
      }
    });
  }

  async function handleDelete() {
    if (!presentationId) return;
    if (!confirm(t("deleteConfirm"))) return;
    setError(null);
    startTransition(async () => {
      try {
        await deletePresentation({ presentationId, eventId, eventSlug });
        onDelete?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
    >
      <input
        type="text"
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        placeholder={t("titlePlaceholder")}
        required
        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      <textarea
        rows={2}
        value={draft.abstract}
        onChange={(e) => setDraft({ ...draft, abstract: e.target.value })}
        placeholder={t("abstractPlaceholder")}
        className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />

      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t("fileLabel")}
        </label>
        {draft.filePath && !stagedFile && (
          <p className="text-xs text-zinc-500">
            {t("currentFile", { name: draft.fileName || draft.filePath })}{" "}
            <button
              type="button"
              onClick={() =>
                setDraft({
                  ...draft,
                  filePath: undefined,
                  fileUrl: undefined,
                  fileName: undefined,
                })
              }
              className="ml-1 text-red-600 hover:underline"
            >
              {t("delete")}
            </button>
          </p>
        )}
        <input
          type="file"
          onChange={(e) => setStagedFile(e.target.files?.[0] ?? null)}
          accept=".pdf,.ppt,.pptx,.key,.odp,application/pdf,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          className="block w-full text-sm"
        />
        {stagedFile && (
          <p className="text-xs text-zinc-500">
            {t("selectedFile", {
              name: stagedFile.name,
              size: (stagedFile.size / 1024 / 1024).toFixed(1),
            })}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t("externalUrlLabel")}
        </label>
        <input
          type="url"
          value={draft.externalSlidesUrl}
          onChange={(e) =>
            setDraft({ ...draft, externalSlidesUrl: e.target.value })
          }
          placeholder="https://..."
          className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>

      {progress !== null && (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {t("uploading", { progress: progress.toFixed(0) })}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || progress !== null}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {progress !== null
            ? t("uploadingButton")
            : pending
              ? t("saving")
              : mode === "create"
                ? t("save")
                : t("update")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending || progress !== null}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {t("cancel")}
        </button>
        {mode === "edit" && onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="ml-auto rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
          >
            {t("delete")}
          </button>
        )}
      </div>
    </form>
  );
}
