"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { deleteComment, postComment } from "@/app/actions/comments";
import { LikeButton } from "@/components/likes/LikeButton";
import { parentRoutePrefix } from "@/lib/comments-parent";
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

  // One-level thread tree: each root keeps its replies as children. A
  // reply-to-a-reply collapses up to the same root so nesting never
  // exceeds one level; the direct parent is still shown via "Re: @author".
  // A reply whose parent is missing (root was deleted — deleteComment
  // does not cascade) is promoted to a root so it stays visible.
  const threads = useMemo(() => {
    const rootIdOf = (c: CommentDoc): string => {
      let cur: CommentDoc | undefined = c;
      const seen = new Set<string>();
      while (cur?.parentCommentId) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        const next = byId.get(cur.parentCommentId);
        if (!next) break;
        cur = next;
      }
      return cur?.id ?? c.id;
    };
    const roots: CommentDoc[] = [];
    const children = new Map<string, CommentDoc[]>();
    for (const c of comments) {
      const hasResolvedParent =
        !!c.parentCommentId && byId.has(c.parentCommentId);
      if (!hasResolvedParent) {
        roots.push(c);
      } else {
        const rid = rootIdOf(c);
        const list = children.get(rid) ?? [];
        list.push(c);
        children.set(rid, list);
      }
    }
    return roots.map((r) => ({ root: r, replies: children.get(r.id) ?? [] }));
  }, [comments, byId]);

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

  async function handleDelete(commentId: string, hard = false) {
    const prompt = hard
      ? "このコメントを完全に削除しますか？復元できません。"
      : "このコメントを削除しますか？";
    if (!confirm(prompt)) return;
    setError(null);
    startTransition(async () => {
      try {
        const updated = await deleteComment({
          parentType,
          parentId,
          commentId,
          hard,
        });
        setComments((cur) =>
          updated === null
            ? cur.filter((c) => c.id !== commentId)
            : cur.map((c) => (c.id === commentId ? updated : c)),
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "削除に失敗しました");
      }
    });
  }

  const bodyId = `comment-body-${parentId}`;
  const loginRedirect = `${parentRoutePrefix(parentType)}/${parentSlug}`;

  function renderComment(c: CommentDoc) {
    const isDeleted = !!c.deletedAt;
    const repliesTo = c.parentCommentId ? byId.get(c.parentCommentId) : null;

    if (isDeleted) {
      return (
        <article className="rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <header className="flex items-start justify-between gap-3">
            <span className="text-xs text-zinc-500">
              {formatDateTime(c.createdAt)}
            </span>
            {user?.isAdmin && (
              <button
                type="button"
                onClick={() => handleDelete(c.id, true)}
                disabled={pending}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                完全に削除
              </button>
            )}
          </header>
          {repliesTo && (
            <p className="mt-1 text-xs text-zinc-500">
              Re: <span className="font-medium">@{repliesTo.authorName}</span>
            </p>
          )}
          <p className="mt-2 text-sm italic text-zinc-500">
            このコメントは削除されました
          </p>
        </article>
      );
    }

    const canDelete =
      !!user && (user.uid === c.authorUid || user.isAdmin);
    const likeKey = `comment:${c.id}`;
    const isReplyOpen = replyingTo === c.id;
    return (
      <article className="rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
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
            onSubmit={(e) => handleSubmit(e, { parentCommentId: c.id })}
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
      </article>
    );
  }

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
          {threads.map(({ root, replies }) => (
            <li key={root.id} className="space-y-3">
              {renderComment(root)}
              {replies.length > 0 && (
                <ul className="ml-6 space-y-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
                  {replies.map((r) => (
                    <li key={r.id}>{renderComment(r)}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
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
