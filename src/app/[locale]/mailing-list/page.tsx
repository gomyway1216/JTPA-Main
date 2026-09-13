import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { MailingListForm } from "@/app/[locale]/mailing-list/_components/MailingListForm";
import Link from "@/i18n/navigation";
import { absoluteLocalizedUrl, localizedAlternates } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "MailingList" });
  const title = t("metadataTitle");
  const description = t("metadataDescription");
  return {
    title,
    description,
    alternates: localizedAlternates("/mailing-list", locale),
    openGraph: {
      title,
      description,
      url: absoluteLocalizedUrl("/mailing-list", locale),
    },
  };
}

export default async function MailingListPage() {
  const t = await getTranslations("MailingList");

  return (
    <main className="mx-auto max-w-2xl space-y-8 px-4 py-12">
      <header className="space-y-3">
        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
          {t("eyebrow")}
        </p>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t("description")}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t("whatYouReceive")}</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>{t("eventUpdates")}</li>
          <li>{t("communityUpdates")}</li>
        </ul>
      </section>

      <MailingListForm />

      <p className="text-xs leading-5 text-zinc-500">
        {t.rich("privacyNote", {
          helpLink: (chunks) => (
            <Link href="/help#feedback" className="text-blue-600 hover:underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </main>
  );
}
