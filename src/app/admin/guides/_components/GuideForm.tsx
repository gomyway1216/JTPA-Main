"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, useTransition } from "react";

import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import {
  createGuide,
  deleteGuide,
  updateGuide,
  type GuideFormInput,
} from "@/app/actions/guides";
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
          await createGuide(payload);
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
        <div data-color-mode={colorMode}>
          <MDEditor
            value={body}
            onChange={(v) => setBody(v ?? "")}
            height={500}
            preview="live"
          />
        </div>
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-between">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        {mode === "edit" && (
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
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
