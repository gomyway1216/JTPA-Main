"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setProjectVisibility } from "@/app/actions/projects";

export function ProjectVisibilityButton({
  projectId,
  visible,
}: {
  projectId: string;
  visible: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const t = useTranslations("Admin.projects");
  const common = useTranslations("Admin.common");

  function toggle() {
    setError(null);
    if (!visible && !confirm(t("archiveConfirm"))) return;
    startTransition(async () => {
      try {
        const res = await setProjectVisibility(projectId, visible);
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
        {visible ? common("publish") : t("archive")}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
