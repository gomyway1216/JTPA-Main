import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("MyPage"),
  ]);
  const user = await getSessionUser();
  if (!user) redirect(loginPath("/my", locale));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {user.displayName} ({user.email})
        </p>
      </header>

      <nav className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/my/rsvps"
          className="rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-lg font-semibold">{t("rsvpsTitle")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("rsvpsDescription")}
          </p>
        </Link>
        <Link
          href="/my/projects"
          className="rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-lg font-semibold">{t("projectsTitle")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("projectsDescription")}
          </p>
        </Link>
        <Link
          href="/my/posts"
          className="rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-lg font-semibold">{t("postsTitle")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("postsDescription")}
          </p>
        </Link>
        <Link
          href="/my/likes"
          className="rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-lg font-semibold">{t("likesTitle")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("likesDescription")}
          </p>
        </Link>
        <Link
          href="/my/profile"
          className="rounded-lg border border-zinc-200 bg-white p-5 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="text-lg font-semibold">{t("profileTitle")}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t("profileDescription")}
          </p>
        </Link>
      </nav>
    </div>
  );
}
