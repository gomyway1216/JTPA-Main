import Link from "@/i18n/navigation";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { GuideListClient } from "@/app/[locale]/guide/_components/GuideListClient";
import { loginHref } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { listGuides } from "@/lib/data/guides";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("GuidePage");
  return { title: t("metadataTitle") };
}

export default async function GuideIndexPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("GuidePage"),
  ]);
  // Intentionally not catching — see the admin list rationale: a missing
  // composite index here surfaces a fix-this link in the error, swallowing
  // it would hide the easiest debug signal.
  const [user, guides] = await Promise.all([
    getSessionUser(),
    listGuides({
      statuses: ["published"],
      limit: 200,
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-8">
      {/* Stack the CTA below the heading on phones (otherwise the
          long subtitle gets squeezed into a narrow column next to the
          "ガイドを投稿" button). From `sm:` we restore the desktop
          side-by-side layout. */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t("title")}</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("description")}
          </p>
        </div>
        {/* Submit-button location matches /qa and /poll: top-right of the
            list page (or below the heading on mobile) so signed-in
            users see an obvious entry point. Logged-out visitors get
            an alternate Sign-in-and-write CTA. */}
        {user ? (
          <Link
            href="/guide/new"
            className="w-fit shrink-0 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {t("submit")}
          </Link>
        ) : (
          <Link
            href={loginHref("/guide/new", locale)}
            className="w-fit shrink-0 rounded-full border border-zinc-300/70 px-5 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700/70 dark:hover:bg-zinc-800"
          >
            {t("loginSubmit")}
          </Link>
        )}
      </header>
      <GuideListClient guides={guides} />
    </div>
  );
}
