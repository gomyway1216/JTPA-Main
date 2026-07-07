import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { getSessionUser } from "@/lib/auth/session";
import { listAuditLogs } from "@/lib/data/audit-logs";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import type { AuditLogDoc } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.audit");
  return { title: t("metadataTitle") };
}

export default async function AdminAuditPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [locale, t, logs] = await Promise.all([
    getLocale(),
    getTranslations("Admin.audit"),
    listAuditLogs(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t("description", { count: logs.length })}
        </p>
      </div>

      {logs.length === 0 ? (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {logs.map((log) => (
            <AuditLogItem key={log.id} log={log} locale={locale} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditLogItem({
  log,
  locale,
}: {
  log: AuditLogDoc;
  locale: string;
}) {
  const title = log.targetTitle || log.targetSlug || log.targetId;
  const resultClass =
    log.result === "success"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : log.result === "denied"
        ? "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
        : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";

  return (
    <li className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        <span>{formatDateTime(log.createdAt, locale)}</span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono dark:bg-zinc-800">
          {log.action}
        </span>
        <span className={`rounded px-1.5 py-0.5 font-medium ${resultClass}`}>
          {log.result}
        </span>
      </div>
      <p className="mt-1 font-medium break-words">{title}</p>
      <p className="mt-0.5 break-words text-xs text-zinc-500">
        actor: {log.actorName || log.actorEmail || log.actorUid}
        {" · "}
        target: {log.targetType}/{log.targetId}
        {log.targetOwnerName ? ` · owner: ${log.targetOwnerName}` : ""}
        {log.targetStatus ? ` · status: ${log.targetStatus}` : ""}
      </p>
      {log.metadata && Object.keys(log.metadata).length > 0 && (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
          {JSON.stringify(log.metadata, null, 2)}
        </pre>
      )}
    </li>
  );
}
