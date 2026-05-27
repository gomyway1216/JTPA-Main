"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { decideProject } from "@/app/actions/projects";
import type { ProjectDoc } from "@/lib/types";

export function ProjectReviewCard({ project }: { project: ProjectDoc }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(decision: "approved" | "rejected") {
    setError(null);
    if (decision === "rejected" && !note.trim()) {
      if (!confirm("コメントなしで却下しますか？")) return;
    }
    startTransition(async () => {
      try {
        await decideProject(project.id, decision, note);
      } catch (err) {
        setError(err instanceof Error ? err.message : "失敗しました");
      }
    });
  }

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{project.title}</h3>
          <p className="text-xs text-zinc-500">
            {project.ownerName} ·{" "}
            <a
              href={project.appUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="text-blue-600 hover:underline"
            >
              アプリを開く
            </a>
            {project.repoUrl && (
              <>
                {" · "}
                <a
                  href={project.repoUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-blue-600 hover:underline"
                >
                  リポジトリ
                </a>
              </>
            )}
          </p>
        </div>
        <Link
          href={`/showcase/${project.slug}`}
          className="text-xs text-zinc-500 hover:underline"
        >
          プレビュー
        </Link>
      </header>
      <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
        {project.description}
      </p>
      {(project.thumbnail || (project.screenshots?.length ?? 0) > 0) && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {project.thumbnail && (
            <li>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={project.thumbnail.url}
                alt="thumbnail"
                className="h-20 w-20 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
            </li>
          )}
          {project.screenshots?.map((s, i) => (
            <li key={s.path}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.url}
                alt={`screenshot ${i + 1}`}
                className="h-20 w-20 rounded border border-zinc-200 object-cover dark:border-zinc-800"
              />
            </li>
          ))}
        </ul>
      )}
      {project.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {project.tags.map((t) => (
            <span
              key={t}
              className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <textarea
        rows={2}
        placeholder="コメント (却下時に投稿者へ送信)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="mt-3 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("approved")}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          承認
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("rejected")}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950 disabled:opacity-50"
        >
          却下
        </button>
      </div>
    </article>
  );
}
