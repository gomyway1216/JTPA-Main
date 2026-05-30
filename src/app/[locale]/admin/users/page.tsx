import { getTranslations } from "next-intl/server";

import { EmailRecipientsExportBar } from "@/app/[locale]/admin/users/_components/EmailRecipientsExportBar";
import { UserTable } from "@/app/[locale]/admin/users/_components/UserTable";
import { getSessionUser } from "@/lib/auth/session";
import {
  listAllUsersForAdmin,
  listOptedInRecipients,
} from "@/lib/data/users-admin";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const me = await getSessionUser();
  if (!me?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const t = await getTranslations("Admin.users");

  // Auth list (for the table) and opt-in list (for the export) are read in
  // parallel — they hit different backends (Firebase Auth vs Firestore) so
  // there's no contention.
  const [{ users, truncated }, recipients] = await Promise.all([
    listAllUsersForAdmin(),
    listOptedInRecipients(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <span className="text-xs text-zinc-500">
          {t("count", { count: users.length })}
        </span>
      </div>

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        {t("roleChangeNotice")}
      </p>

      {truncated && (
        <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
          {t("truncatedNotice")}
        </p>
      )}

      <EmailRecipientsExportBar
        recipients={recipients}
        totalUsers={users.length}
      />

      <UserTable users={users} currentUid={me.uid} truncated={truncated} />
    </div>
  );
}
