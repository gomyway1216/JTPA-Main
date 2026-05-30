import { getLocale, getTranslations } from "next-intl/server";

import { getSessionUser } from "@/lib/auth/session";
import { listErrorLogs } from "@/lib/data/error-logs";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Admin-only viewer for the `errorLogs` collection populated by
// instrumentation's onRequestError. The layout already gates /admin to
// admins+editors; this page is admin-only, so re-check and bounce editors
// to a page they can use (mirrors the events edit page guard).
export default async function AdminErrorsPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("Admin.errors"),
  ]);

  const logs = await listErrorLogs();

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
            <li
              key={log.id}
              className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                <span>{formatDateTime(log.createdAt, locale)}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">
                  {log.routeType || "—"}
                </span>
                {log.requestId && (
                  <span className="font-mono">requestId: {log.requestId}</span>
                )}
              </div>
              <p className="mt-1 font-medium break-words">
                {log.message || t("noMessage")}
              </p>
              <p className="mt-0.5 break-words text-xs text-zinc-500">
                {[log.method, log.path].filter(Boolean).join(" ")}
                {log.routePath && log.routePath !== log.path
                  ? ` (${log.routePath})`
                  : ""}
              </p>
              {log.stack && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-zinc-500">
                    {t("stackTrace")}
                  </summary>
                  <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
                    {log.stack}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
