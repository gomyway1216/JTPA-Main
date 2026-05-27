"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteComment, postComment } from "@/app/actions/comments";
import type { PostCommentDoc, SessionUser } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const MAX_BODY = 2000;

export function CommentsSection({
  postId,
  postSlug,
  initialComments,
  user,
}: {
  postId: string;
  postSlug: string;
  initialComments: PostCommentDoc[];
  user: SessionUser | null;
}) {
  const [comments, setComments] =
    useState<PostCommentDoc[]>(initialComments);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user || !body.trim()) return;
    startTransition(async () => {
      try {
        const saved = await postComment({
          postId,
          body: body.trim(),
        });
        setComments((cur) => [...cur, saved]);
        setBody("");
        // Re-fetch the Server Component data so any other surface that
        // shows comment counts (none today, but planned) refreshes too.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "送信に失敗しました");
      }
    });
  }

  async function handleDelete(commentId: string) {
    if (!confirm("このコメントを削除しますか？")) return;
    setError(null);
    startTransition(async () => {
      try {
        await deleteComment({ postId, commentId });
        setComments((cur) => cur.filter((c) => c.id !== commentId));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  const bodyId = `comment-body-${postId}`;

  return (
    <section
      aria-label="コメント"
      className="border-t border-zinc-200 pt-6 dark:border-zinc-800"
    >
      <h2 className="text-lg font-semibold">コメント ({comments.length})</h2>

      {comments.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">
          まだコメントはありません。
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {comments.map((c) => {
            const canDelete =
              !!user && (user.uid === c.authorUid || user.isAdmin);
            return (
              <li
                key={c.id}
                className="rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <header className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {c.authorPhotoURL && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={c.authorPhotoURL}
                        alt=""
                        className="h-6 w-6 rounded-full"
                      />
                    )}
                    <span className="font-medium">{c.authorName}</span>
                    <span className="text-xs text-zinc-500">
                      {formatDateTime(c.createdAt)}
                    </span>
                  </div>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => handleDelete(c.id)}
                      disabled={pending}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      削除
                    </button>
                  )}
                </header>
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {c.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {user ? (
          <form onSubmit={handleSubmit} className="space-y-2">
            <label htmlFor={bodyId} className="sr-only">
              コメント本文
            </label>
            <textarea
              id={bodyId}
              rows={3}
              maxLength={MAX_BODY}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={pending}
              placeholder="コメントを入力 (最大 2000 文字)"
              className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {body.length} / {MAX_BODY}
              </p>
              <button
                type="submit"
                disabled={pending || !body.trim()}
                className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                {pending ? "送信中..." : "コメントする"}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </form>
        ) : (
          <div className="rounded-md border border-zinc-200 p-4 text-center text-sm dark:border-zinc-800">
            <p className="text-zinc-700 dark:text-zinc-300 mb-2">
              コメントするにはログインが必要です。
            </p>
            <Link
              href={`/login?redirect=${encodeURIComponent(`/blog/${postSlug}`)}`}
              className="inline-flex rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Googleでログイン
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
