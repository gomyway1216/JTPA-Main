import { getTranslations } from "next-intl/server";

import Link from "@/i18n/navigation";

/** Public reading pages share a path from an example to joining the community. */
export async function ReaderNextSteps() {
  const t = await getTranslations("ReaderNextSteps");

  return (
    <aside className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {t("description")}
      </p>
      <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm font-medium">
        <Link href="/events" className="text-accent hover:underline">
          {t("events")}
        </Link>
        <Link href="/guide" className="text-accent hover:underline">
          {t("guides")}
        </Link>
        <Link href="/mailing-list" className="text-accent hover:underline">
          {t("mailingList")}
        </Link>
      </div>
    </aside>
  );
}
