import Link from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { loginPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";
import { getMyProfile } from "@/lib/data/users";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  const user = await getSessionUser();
  if (!user) {
    const locale = await getLocale();
    redirect(loginPath("/my", locale));
  }

  const [t, profile] = await Promise.all([
    getTranslations("MyPage"),
    getMyProfile(user.uid).catch(() => null),
  ]);
  const attendanceCount = Math.max(0, profile?.eventAttendanceCount ?? 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {user.displayName} ({user.email})
        </p>
      </header>

      <section className="border-y border-zinc-200 py-4 dark:border-zinc-800">
        <p className="text-xs font-medium uppercase text-zinc-500">
          {t("attendanceCountLabel")}
        </p>
        <p className="mt-1 text-2xl font-semibold">
          {t("attendanceCountValue", { count: attendanceCount })}
        </p>
      </section>

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
