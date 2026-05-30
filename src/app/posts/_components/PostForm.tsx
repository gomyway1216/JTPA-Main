"use client";

import dynamic from "next/dynamic";
import {
  ref as storageRef,
  uploadBytesResumable,
} from "firebase/storage";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  deleteMyPost,
  submitPost,
  updateMyPost,
  type PostFormInput,
} from "@/app/actions/posts";
import { Field } from "@/components/forms/Field";
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "@/components/forms/styles";
import { localizedPath } from "@/i18n/paths";
import { clientStorage } from "@/lib/firebase/client";
import { publicDownloadUrl } from "@/lib/firebase/uploads";
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
// Japanese commas work alongside ASCII commas.
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
  const locale = useLocale();
  const t = useTranslations("PostForm");
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
      return Promise.reject(new Error(t("imageTooLarge")));
    }
    if (!(ALLOWED_MIME as readonly string[]).includes(file.type)) {
      return Promise.reject(new Error(t("imageType")));
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
        () => {
          // posts/{uid}/ has `allow read: if true` in storage.rules, so we
          // skip the getDownloadURL fetch entirely and build the URL from
          // the upload ref. No second network round-trip, no token in the
          // persisted Markdown body.
          resolve({ path, url: publicDownloadUrl(task.snapshot.ref) });
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
      setError(err instanceof Error ? err.message : t("uploadFailed"));
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
        setError(err instanceof Error ? err.message : t("saveFailed"));
      }
    });
  }

  async function handleDelete() {
    if (!post) return;
    if (!confirm(t("deleteConfirm"))) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteMyPost(post.id);
        window.location.href = localizedPath("/my/posts", locale);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteFailed"));
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
      <Field label={t("title")} required htmlFor="post-title">
        <input
          id="post-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field
        label={t("excerpt")}
        required
        htmlFor="post-excerpt"
      >
        <textarea
          id="post-excerpt"
          required
          rows={2}
          maxLength={300}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-zinc-500">{excerpt.length} / 300</p>
      </Field>

      <Field label={t("body")} required>
        <div data-color-mode={colorMode}>
          <MDEditor
            value={body}
            onChange={(v) => setBody(v ?? "")}
            height={500}
            preview="live"
          />
        </div>
      </Field>

      <Field label={t("tags")} htmlFor="post-tags">
        <input
          id="post-tags"
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder={t("tagsPlaceholder")}
          className={inputClass}
        />
      </Field>

      <Field label={t("cover")}>
        <div className="space-y-2">
          {coverImage && (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverImage.url}
                alt={t("coverPreviewAlt")}
                className="h-20 w-32 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
              <button
                type="button"
                onClick={() => setCoverImage(undefined)}
                className="text-xs text-red-600 hover:underline"
              >
                {t("delete")}
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
              {t("uploading", { progress: coverProgress.toFixed(0) })}
            </p>
          )}
        </div>
      </Field>

      {error && <p className={errorTextClass}>{error}</p>}
      {mode === "edit" && !user.isAdmin && (
        <p className="text-xs text-zinc-500">
          {t("editReviewNotice")}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || uploading}
          onClick={() => submit("draft")}
          className={secondaryButtonClass}
        >
          {t("saveDraft")}
        </button>
        <button
          type="submit"
          disabled={pending || uploading}
          className={primaryButtonClass}
        >
          {pending
            ? t("submitting")
            : uploading
              ? t("uploadingButton")
              : mode === "create"
                ? t("submitForReview")
                : t("updateForReview")}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            disabled={pending}
            onClick={handleDelete}
            className={`ml-auto ${dangerButtonClass}`}
          >
            {t("delete")}
          </button>
        )}
      </div>
    </form>
  );
}
