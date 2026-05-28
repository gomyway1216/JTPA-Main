"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  toggleLikeComment,
  toggleLikeRecord,
  type LikeResult,
} from "@/app/actions/likes";
import type { CommentParentType, SessionUser } from "@/lib/types";

interface CommonProps {
  parentType: CommentParentType;
  parentId: string;
  parentSlug: string;
  initialLiked: boolean;
  initialCount: number;
  user: SessionUser | null;
  // Visual variant. The record-level button is larger and lives in the
  // page header; comment-level is inline-compact in the comment row.
  size?: "lg" | "sm";
}

type Props =
  // Two render modes, with the discriminator picking which Server Action
  // to call. Adding more like targets later (e.g. project showcase) means
  // adding another arm here.
  | (CommonProps & { target: "record" })
  | (CommonProps & { target: "comment"; commentId: string });

export function LikeButton(props: Props) {
  const [liked, setLiked] = useState(props.initialLiked);
  const [count, setCount] = useState(props.initialCount);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!props.user) return; // CTA below handles the anonymous case
    if (pending) return;
    setError(null);

    // Optimistic flip — set the new state before the server resolves so
    // the click feels instant. If the action rejects we revert below.
    const prevLiked = liked;
    const prevCount = count;
    setLiked(!prevLiked);
    setCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1);

    startTransition(async () => {
      try {
        let result: LikeResult;
        if (props.target === "record") {
          result = await toggleLikeRecord({
            parentType: props.parentType,
            parentId: props.parentId,
          });
        } else {
          result = await toggleLikeComment({
            parentType: props.parentType,
            parentId: props.parentId,
            commentId: props.commentId,
          });
        }
        // Reconcile with server truth (e.g. count may differ if another
        // client liked at the same instant). `liked` for THIS user is
        // authoritative from the server.
        setLiked(result.liked);
        setCount(result.count);
      } catch (err) {
        // Revert the optimistic flip on failure.
        setLiked(prevLiked);
        setCount(prevCount);
        setError(err instanceof Error ? err.message : "更新に失敗しました");
      }
    });
  }

  const isLg = props.size !== "sm";
  const baseCls = isLg
    ? "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition"
    : "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition";
  const stateCls = liked
    ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300"
    : "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900";

  if (!props.user) {
    // Anonymous visitors see the count but the button routes to login
    // with a return-to so they land back on the same page after auth.
    const redirect = `${props.parentType === "post" ? "/blog" : "/guide"}/${props.parentSlug}`;
    return (
      <Link
        href={`/login?redirect=${encodeURIComponent(redirect)}`}
        className={`${baseCls} ${stateCls}`}
        aria-label="いいねするにはログイン"
        title="いいねするにはログインが必要です"
      >
        <span aria-hidden>♡</span>
        <span>{count}</span>
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        aria-pressed={liked}
        aria-label={liked ? "いいねを取り消す" : "いいねする"}
        className={`${baseCls} ${stateCls} disabled:opacity-60`}
      >
        <span aria-hidden>{liked ? "♥" : "♡"}</span>
        <span>{count}</span>
      </button>
      {error && (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
