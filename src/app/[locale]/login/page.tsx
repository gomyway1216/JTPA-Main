import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { SignInButton } from "@/components/auth/SignInButton";
import { safeRedirectPath } from "@/i18n/paths";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) {
  const [locale, t] = await Promise.all([
    getLocale(),
    getTranslations("Login"),
  ]);
  const user = await getSessionUser();
  const { redirect: redirectTo } = await searchParams;
  const redirectPath = safeRedirectPath(redirectTo, locale);
  if (user) redirect(redirectPath);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("description")}
        </p>
      </div>
      <SignInButton redirectTo={redirectPath} />
    </div>
  );
}
