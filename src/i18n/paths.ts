import { routing } from "@/i18n/routing";

export function localizedPath(path: string, locale: string): string {
  if (!path.startsWith("/") || locale === routing.defaultLocale) return path;
  if (path === "/") return `/${locale}`;
  return `/${locale}${path}`;
}

export function loginHref(redirectTo: string, locale: string): string {
  const localizedRedirect = localizedPath(redirectTo, locale);
  return `/login?redirect=${encodeURIComponent(localizedRedirect)}`;
}

export function loginPath(redirectTo: string, locale: string): string {
  return localizedPath(loginHref(redirectTo, locale), locale);
}
