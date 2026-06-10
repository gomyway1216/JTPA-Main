"use client";

import Link from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { decidePost } from "@/app/actions/posts";
import type { PublicProfile } from "@/lib/data/users";
import type { PostDoc } from "@/lib/types";
import { formatDate } from "@/lib/utils";

export function PostReviewCard({
  post,
  authorProfile,
}: {
  post: PostDoc;
  // Resolved server-side by the parent admin page so this card can show
  // the author's current @username instead of the denormalized
  // `post.authorName` snapshot. `null` means the user doc is gone — we
  // fall back to the denormalized name so the review queue still
  // identifies who submitted the post.
  authorProfile: PublicProfile | null;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("Admin.posts");
  const projectsT = useTranslations("Admin.projects");
  const common = useTranslations("Admin.common");

  function decide(decision: "published" | "rejected") {
    setError(null);
    if (decision === "rejected" && !note.trim()) {
      if (!confirm(projectsT("rejectWithoutNoteConfirm"))) return;
    }
    startTransition(async () => {
      try {
        const res = await decidePost(post.id, decision, note);
        if (!res.ok) {
          // Surface the real reason instead of the masked generic crash.
          setError(res.error);
          return;
        }
        // revalidatePath inside the Server Action invalidates the cache,
        // but the existing client-side React tree won't re-fetch until we
        // tell the router to refresh. Without this the just-decided card
        // would linger in the pending list until manual reload.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : projectsT("failed"));
      }
    });
  }

  // Unique-per-card id so the <label>'s for/id pairing isn't ambiguous when
  // the queue lists multiple cards.
  const noteId = `review-note-${post.id}`;

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold">{post.title}</h3>
          <p className="text-xs text-zinc-500">
            {authorProfile ? `@${authorProfile.username}` : post.authorName}
            {" · "}
            {t("submitted", { date: formatDate(post.submittedAt, locale) })}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-xs">
          <Link
            href={`/blog/${post.slug}`}
            className="text-zinc-500 hover:underline"
          >
            {common("preview")}
          </Link>
          <Link
            href={`/admin/posts/${post.id}/edit`}
            className="text-zinc-500 hover:underline"
          >
            {common("editContent")}
          </Link>
        </div>
      </header>

      {post.coverImage?.url && (
        <Image
          src={post.coverImage.url}
          alt={t("coverAlt", { title: post.title })}
          width={1600}
          height={900}
          sizes="100vw"
          className="mt-3 h-32 w-full rounded border border-zinc-200 object-cover dark:border-zinc-800"
        />
      )}

      <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
        {post.excerpt}
      </p>

      {post.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {post.tags.map((t) => (
            <span
              key={t}
              className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {t}
            </span>
          ))}
        </div>
      )}

      <label htmlFor={noteId} className="sr-only">
        {projectsT("notePlaceholder")}
      </label>
      <textarea
        id={noteId}
        rows={2}
        placeholder={projectsT("notePlaceholder")}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={pending}
        className="mt-3 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 disabled:opacity-50"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("published")}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {common("publish")}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => decide("rejected")}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
        >
          {common("reject")}
        </button>
      </div>
    </article>
  );
}
