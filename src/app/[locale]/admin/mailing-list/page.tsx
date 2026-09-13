import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LoadErrorBanner } from "@/app/[locale]/admin/_components/LoadErrorBanner";
import { MailingListManager } from "@/app/[locale]/admin/mailing-list/_components/MailingListManager";
import { getSessionUser } from "@/lib/auth/session";
import { listMailingListSubscribers } from "@/lib/data/mailing-list";
import { safeLoad } from "@/lib/data/safe-load";
import { redirectToLocalizedPath } from "@/lib/i18n/redirects";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Admin.mailingList");
  return { title: t("metadataTitle") };
}

export default async function AdminMailingListPage() {
  const user = await getSessionUser();
  if (!user?.isAdmin) return redirectToLocalizedPath("/admin/guides");
  const t = await getTranslations("Admin.mailingList");
  const result = await safeLoad("mailing list subscribers", () =>
    listMailingListSubscribers(),
  );
  const subscribers = result.ok ? result.data : [];

  return (
    <div className="space-y-6">
      <LoadErrorBanner show={!result.ok} />
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {t("description", { count: subscribers.length })}
        </p>
      </header>
      <MailingListManager subscribers={subscribers} />
    </div>
  );
}
