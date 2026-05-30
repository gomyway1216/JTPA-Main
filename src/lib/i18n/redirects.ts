import { getLocale } from "next-intl/server";
import { redirect } from "next/navigation";

import { localizedPath, loginPath } from "@/i18n/paths";
import { routing, type AppLocale } from "@/i18n/routing";

async function resolveLocale(locale?: string): Promise<AppLocale> {
  if (routing.locales.includes(locale as AppLocale)) {
    return locale as AppLocale;
  }
  try {
    return (await getLocale()) as AppLocale;
  } catch {
    return routing.defaultLocale;
  }
}

export async function redirectToLocalizedPath(
  path: string,
  locale?: string,
): Promise<never> {
  const resolvedLocale = await resolveLocale(locale);
  redirect(localizedPath(path, resolvedLocale));
}

export async function redirectToLoginPath(
  redirectTo: string,
  locale?: string,
): Promise<never> {
  const resolvedLocale = await resolveLocale(locale);
  redirect(loginPath(redirectTo, resolvedLocale));
}
