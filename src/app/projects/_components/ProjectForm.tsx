"use client";

import { useState, useTransition } from "react";

import { submitProject, updateMyProject } from "@/app/actions/projects";
import type { ProjectDoc } from "@/lib/types";

interface Props {
  mode: "create" | "edit";
  project?: ProjectDoc;
}

export function ProjectForm({ mode, project }: Props) {
  const [title, setTitle] = useState(project?.title ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [tags, setTags] = useState(project?.tags?.join(", ") ?? "");
  const [appUrl, setAppUrl] = useState(project?.appUrl ?? "");
  const [repoUrl, setRepoUrl] = useState(project?.repoUrl ?? "");
  const [demoVideoUrl, setDemoVideoUrl] = useState(project?.demoVideoUrl ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
          screenshots: [],
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
      <Field label="説明 (Markdown可)" required>
        <textarea
          required
          rows={6}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="タグ (カンマ区切り)">
        <input
          type="text"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="LLM, RAG, Agent"
          className={inputCls}
        />
      </Field>
      <Field label="アプリのURL" required>
        <input
          type="url"
          required
          value={appUrl}
          onChange={(e) => setAppUrl(e.target.value)}
          placeholder="https://your-app.example.com"
          className={inputCls}
        />
      </Field>
      <Field label="リポジトリURL">
        <input
          type="url"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="デモ動画URL (YouTube等)">
        <input
          type="url"
          value={demoVideoUrl}
          onChange={(e) => setDemoVideoUrl(e.target.value)}
          className={inputCls}
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mode === "edit" && (
        <p className="text-xs text-zinc-500">
          編集すると再度「審査中」となり、管理者の承認後に再掲載されます。
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
      >
        {pending
          ? "送信中..."
          : mode === "create"
            ? "投稿して審査依頼"
            : "更新して再審査"}
      </button>
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
