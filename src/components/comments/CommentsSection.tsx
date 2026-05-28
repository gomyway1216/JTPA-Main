"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { deleteComment, postComment } from "@/app/actions/comments";
import { LikeButton } from "@/components/likes/LikeButton";
import type {
  CommentDoc,
  CommentParentType,
  SessionUser,
} from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

const MAX_BODY = 2000;

interface Props {
  parentType: CommentParentType;
  parentId: string;
  parentSlug: string;
  initialComments: CommentDoc[];
  // Set of "like target" keys the current user has already liked. Members
  // are either `RECORD_LIKE_KEY` or `comment:{commentId}`. Empty for
  // anonymous visitors.
  initialLikedKeys: string[];
  user: SessionUser | null;
}

export function CommentsSection({
  parentType,
  parentId,
  parentSlug,
  initialComments,
  initialLikedKeys,
  user,
}: Props) {
  const [comments, setComments] = useState<CommentDoc[]>(initialComments);
  const [body, setBody] = useState("");
  // null = top-level comment form. String = inline reply form targeting
  // that comment id. Only one inline reply form is visible at a time.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const likedSet = useMemo(
    () => new Set(initialLikedKeys),
    [initialLikedKeys],
  );

  // Comment lookup by id so a reply can show "Re: @author" pointing at
  // the parent even if it's older / off-screen.
  const byId = useMemo(() => {
    const m = new Map<string, CommentDoc>();
    for (const c of comments) m.set(c.id, c);
    return m;
  }, [comments]);

  async function handleSubmit(
    e: React.FormEvent,
    opts: { parentCommentId: string | null },
  ) {
    e.preventDefault();
    setError(null);
    if (!user) return;
    const text = opts.parentCommentId ? replyBody.trim() : body.trim();
    if (!text) return;
    startTransition(async () => {
      try {
        const saved = await postComment({
          parentType,
          parentId,
          body: text,
          parentCommentId: opts.parentCommentId,
        });
        setComments((cur) => [...cur, saved]);
        if (opts.parentCommentId) {
          setReplyBody("");
          setReplyingTo(null);
        } else {
          setBody("");
        }
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
        await deleteComment({ parentType, parentId, commentId });
        setComments((cur) => cur.filter((c) => c.id !== commentId));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  const bodyId = `comment-body-${parentId}`;
  const loginRedirect = `${parentType === "post" ? "/blog" : "/guide"}/${parentSlug}`;

  return (
    <section
      aria-label="コメント"
      className="border-t border-zinc-200 pt-6 dark:border-zinc-800"
    >
      <h2 className="text-lg font-semibold">コメント ({comments.length})</h2>

      {comments.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">まだコメントはありません。</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {comments.map((c) => {
            const canDelete =
              !!user && (user.uid === c.authorUid || user.isAdmin);
            const repliesTo = c.parentCommentId
              ? byId.get(c.parentCommentId)
              : null;
            const likeKey = `comment:${c.id}`;
            const isReplyOpen = replyingTo === c.id;
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

                {repliesTo && (
                  // "Re: @author" header for replies. We render this as a
                  // mention rather than indenting the comment because Jin
                  // and Yudai picked a linear thread over a nested tree.
                  <p className="mt-1 text-xs text-zinc-500">
                    Re: <span className="font-medium">@{repliesTo.authorName}</span>
                  </p>
                )}

                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {c.body}
                </p>

                <footer className="mt-3 flex items-center gap-3">
                  <LikeButton
                    target="comment"
                    parentType={parentType}
                    parentId={parentId}
                    parentSlug={parentSlug}
                    commentId={c.id}
                    initialLiked={likedSet.has(likeKey)}
                    initialCount={c.likeCount ?? 0}
                    user={user}
                    size="sm"
                  />
                  {user && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isReplyOpen) {
                          setReplyingTo(null);
                          setReplyBody("");
                        } else {
                          setReplyingTo(c.id);
                          setReplyBody("");
                        }
                      }}
                      disabled={pending}
                      className="text-xs text-zinc-600 hover:underline disabled:opacity-50 dark:text-zinc-400"
                    >
                      {isReplyOpen ? "返信をやめる" : "返信"}
                    </button>
                  )}
                </footer>

                {isReplyOpen && (
                  <form
                    onSubmit={(e) =>
                      handleSubmit(e, { parentCommentId: c.id })
                    }
                    className="mt-3 space-y-2"
                  >
                    <textarea
                      rows={2}
                      maxLength={MAX_BODY}
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      disabled={pending}
                      autoFocus
                      placeholder={`@${c.authorName} への返信 (最大 2000 文字)`}
                      className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950 disabled:opacity-50"
                    />
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-zinc-500">
                        {replyBody.length} / {MAX_BODY}
                      </p>
                      <button
                        type="submit"
                        disabled={pending || !replyBody.trim()}
                        className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        {pending ? "送信中..." : "返信する"}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {user ? (
          <form
            onSubmit={(e) => handleSubmit(e, { parentCommentId: null })}
            className="space-y-2"
          >
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
              href={`/login?redirect=${encodeURIComponent(loginRedirect)}`}
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
