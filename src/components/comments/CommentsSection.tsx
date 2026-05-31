"use client";

import Link from "@/i18n/navigation";
import { loginHref } from "@/i18n/paths";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { deleteComment, postComment } from "@/app/actions/comments";
import {
  errorTextClass,
  inputClass,
  primaryButtonClass,
  primaryButtonClassSm,
} from "@/components/forms/styles";
import { LikeButton } from "@/components/likes/LikeButton";
import { DeleteConfirmationDialog } from "@/components/ui/DeleteConfirmationDialog";
import { AuthorBadge } from "@/components/users/AuthorBadge";
import { parentRoutePrefix } from "@/lib/comments-parent";
import type { PublicProfile } from "@/lib/data/users";
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
  // Map of authorUid → current public profile, prefetched by the parent
  // server component for every uid that appears in `initialComments`.
  // Passed as a plain object (not a Map) because Map doesn't survive the
  // RSC→Client serialization boundary. A missing entry means the
  // commenter's user doc is gone (deleted account) — AuthorBadge
  // handles that by rendering an unlinked "@unknown" placeholder.
  profilesByUid: Record<string, PublicProfile>;
  user: SessionUser | null;
}

export function CommentsSection({
  parentType,
  parentId,
  parentSlug,
  initialComments,
  initialLikedKeys,
  profilesByUid,
  user,
}: Props) {
  const t = useTranslations("Comments");
  const locale = useLocale();
  const [comments, setComments] = useState<CommentDoc[]>(initialComments);
  const [body, setBody] = useState("");
  // null = top-level comment form. String = inline reply form targeting
  // that comment id. Only one inline reply form is visible at a time.
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    commentId: string;
    hard: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Separate error slot for the inline reply form so a failed reply shows
  // its message next to that form, not only under the main comment box at
  // the bottom of the thread. Only one reply form is open at a time
  // (replyingTo is a single id), so one slot is enough. Per #128 review.
  const [replyError, setReplyError] = useState<string | null>(null);
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
    // Route feedback to the form the user actually submitted: the inline
    // reply form (replyError) vs the main comment box (error).
    const showError = opts.parentCommentId ? setReplyError : setError;
    showError(null);
    if (!user) return;
    const text = opts.parentCommentId ? replyBody.trim() : body.trim();
    if (!text) return;
    startTransition(async () => {
      try {
        const res = await postComment({
          parentType,
          parentId,
          body: text,
          parentCommentId: opts.parentCommentId,
        });
        if (!res.ok) {
          showError(res.error);
          return;
        }
        setComments((cur) => [...cur, res.comment]);
        if (opts.parentCommentId) {
          setReplyBody("");
          setReplyingTo(null);
        } else {
          setBody("");
        }
        router.refresh();
      } catch (err) {
        showError(err instanceof Error ? err.message : t("sendError"));
      }
    });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const { commentId, hard } = deleteTarget;
    setDeleteTarget(null);
    setError(null);
    startTransition(async () => {
      try {
        const res = await deleteComment({
          parentType,
          parentId,
          commentId,
          hard,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        const updated = res.comment;
        setComments((cur) =>
          updated === null
            ? cur.filter((c) => c.id !== commentId)
            : cur.map((c) => (c.id === commentId ? updated : c)),
        );
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("deleteError"));
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
                onClick={() =>
                  setDeleteTarget({ commentId: c.id, hard: true })
                }
                disabled={pending}
                className="text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                {t("hardDelete")}
              </button>
            )}
          </header>
          {repliesTo && (
            <ReplyToPrefix
              uid={repliesTo.authorUid}
              profile={profilesByUid[repliesTo.authorUid] ?? null}
              fallbackName={repliesTo.authorName}
            />
          )}
          <p className="mt-2 text-sm italic text-zinc-500">
            {t("deleted")}
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
            <AuthorBadge
              profile={profilesByUid[c.authorUid] ?? null}
              size="md"
            />
            <span className="text-xs text-zinc-500">
              {formatDateTime(c.createdAt)}
            </span>
          </div>
          {canDelete && (
            <button
              type="button"
              onClick={() =>
                setDeleteTarget({ commentId: c.id, hard: false })
              }
              disabled={pending}
              className="text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              {t("delete")}
            </button>
          )}
        </header>

        {repliesTo && (
          <ReplyToPrefix
            uid={repliesTo.authorUid}
            profile={profilesByUid[repliesTo.authorUid] ?? null}
            fallbackName={repliesTo.authorName}
          />
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
                // Clear any stale reply error when opening/closing or
                // switching which comment's reply form is shown.
                setReplyError(null);
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
              {isReplyOpen ? t("cancelReply") : t("reply")}
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
              placeholder={t("replyPlaceholder", {
                name: profilesByUid[c.authorUid]?.username ?? c.authorName,
              })}
              className={inputClass}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {replyBody.length} / {MAX_BODY}
              </p>
              <button
                type="submit"
                disabled={pending || !replyBody.trim()}
                className={primaryButtonClassSm}
              >
                {pending ? t("submitting") : t("replySubmit")}
              </button>
            </div>
            {replyError && <p className={errorTextClass}>{replyError}</p>}
          </form>
        )}
      </article>
    );
  }

  return (
    <section
      aria-label={t("label")}
      className="border-t border-zinc-200 pt-6 dark:border-zinc-800"
    >
      <h2 className="text-lg font-semibold">
        {t("heading", { count: comments.length })}
      </h2>

      {comments.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{t("empty")}</p>
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
              {t("bodyLabel")}
            </label>
            <textarea
              id={bodyId}
              rows={3}
              maxLength={MAX_BODY}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={pending}
              placeholder={t("bodyPlaceholder")}
              className={inputClass}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-zinc-500">
                {body.length} / {MAX_BODY}
              </p>
              <button
                type="submit"
                disabled={pending || !body.trim()}
                className={primaryButtonClass}
              >
                {pending ? t("submitting") : t("submit")}
              </button>
            </div>
            {error && <p className={errorTextClass}>{error}</p>}
          </form>
        ) : (
          <div className="rounded-md border border-zinc-200 p-4 text-center text-sm dark:border-zinc-800">
            <p className="text-zinc-700 dark:text-zinc-300 mb-2">
              {t("loginRequired")}
            </p>
            <Link
              href={loginHref(loginRedirect, locale)}
              className="inline-flex rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              {t("googleLogin")}
            </Link>
          </div>
        )}
      </div>
      <DeleteConfirmationDialog
        open={deleteTarget !== null}
        title={
          deleteTarget?.hard ? t("hardDeleteConfirm") : t("deleteConfirm")
        }
        pending={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
    </section>
  );
}

// Small "Re: @author" prefix used above replies. Lives outside the main
// component so it doesn't re-create on every render; takes both the
// looked-up profile (preferred) and the comment's denormalized
// `authorName` as a last-resort fallback for the case where a user doc
// was deleted but the comment doc still carries the historical name.
function ReplyToPrefix({
  uid,
  profile,
  fallbackName,
}: {
  uid: string;
  profile: PublicProfile | null;
  fallbackName: string;
}) {
  // Mirror AuthorBadge's missing-profile behavior: when the replied-to
  // user's doc is gone (deleted account / legacy guest), render the
  // handle as plain text instead of a /u/[uid] link that would 404.
  // Per PR #79 Copilot review.
  const label = profile?.username ?? fallbackName ?? "unknown";
  return (
    <p className="mt-1 text-xs text-zinc-500">
      Re:{" "}
      {profile ? (
        <Link href={`/u/${uid}`} className="font-medium hover:underline">
          @{label}
        </Link>
      ) : (
        <span className="font-medium">@{label}</span>
      )}
    </p>
  );
}
