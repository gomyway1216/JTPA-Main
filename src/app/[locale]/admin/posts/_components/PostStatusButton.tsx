"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { archivePost, publishPost } from "@/app/actions/posts";

export function PostStatusButton({
  postId,
  status,
}: {
  postId: string;
  status: "published" | "archived";
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("Admin.posts");
  const common = useTranslations("Admin.common");
  const publishing = status === "archived";

  function toggle() {
    setError(null);
    if (!publishing && !confirm(t("archiveConfirm"))) return;
    startTransition(async () => {
      try {
        const res = publishing ? await publishPost(postId) : await archivePost(postId);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : t("failed"));
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className="text-blue-600 hover:underline disabled:opacity-50"
      >
        {publishing ? common("publish") : t("archive")}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
