"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { unstable_rethrow } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

import { saveSitePage } from "@/app/actions/site-pages";
import { SaveFlash } from "@/components/forms/SaveFlash";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), {
  ssr: false,
  loading: () => (
    <div className="h-72 animate-pulse rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />
  ),
});

export function AboutForm({
  initialTitle,
  initialBody,
}: {
  initialTitle: string;
  initialBody: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const t = useTranslations("Admin.about");
  const common = useTranslations("Admin.common");

  // Match the MDEditor theme to the OS-level dark mode preference — same
  // approach as GuideForm. The app drives dark mode off prefers-color-scheme
  // rather than a `.dark` class on <html>.
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setColorMode(mq.matches ? "dark" : "light");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveSitePage({ slug: "about", title, body });
        if (!res.ok) {
          // Real validation message surfaced inline, instead of the masked
          // generic "Server Components render" crash — same handling as
          // EventForm. Clear any prior "saved" flash so the UI never shows
          // a stale confirmation alongside the new error.
          setError(res.error);
          setSavedAt(null);
          return;
        }
        setSavedAt(Date.now());
      } catch (err) {
        unstable_rethrow(err);
        setError(err instanceof Error ? err.message : common("saveFailed"));
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="about-title" className="text-sm font-medium">
          {t("titleLabel")} <span className="text-red-600">*</span>
        </label>
        <input
          id="about-title"
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        />
      </div>

      <div>
        <span className="text-sm font-medium">
          {t("bodyLabel")} <span className="text-red-600">*</span>
        </span>
        <div className="mt-1" data-color-mode={colorMode}>
          <MDEditor
            value={body}
            onChange={(v) => setBody(v ?? "")}
            height={500}
            preview="live"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
        >
          {pending ? common("saving") : common("save")}
        </button>
        <SaveFlash savedAt={savedAt} message={common("saved")} />
      </div>
    </form>
  );
}
