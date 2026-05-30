import { routing } from "@/i18n/routing";

function stripLocalePrefix(path: string): string {
  for (const candidate of routing.locales) {
    const prefix = `/${candidate}`;
    if (path === prefix) return "/";
    if (!path.startsWith(prefix)) continue;

    const next = path[prefix.length];
    if (next !== "/" && next !== "?" && next !== "#") continue;

    const stripped = path.slice(prefix.length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }
  return path;
}

function addLocalePrefix(path: string, locale: string): string {
  if (path === "/") return `/${locale}`;
  if (path.startsWith("/?") || path.startsWith("/#")) {
    return `/${locale}${path.slice(1)}`;
  }
  return `/${locale}${path}`;
}

export function localizedPath(path: string, locale: string): string {
  if (!path.startsWith("/")) return path;

  const unlocalized = stripLocalePrefix(path);
  if (locale === routing.defaultLocale) return unlocalized;
  return addLocalePrefix(unlocalized, locale);
}

export function safeRedirectPath(
  redirectTo: string | undefined,
  locale: string,
): string {
  if (
    !redirectTo ||
    !redirectTo.startsWith("/") ||
    redirectTo.startsWith("//") ||
    redirectTo.includes("\\")
  ) {
    return localizedPath("/", locale);
  }
  const path = localizedPath(redirectTo, locale);
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\")
  ) {
    return localizedPath("/", locale);
  }
  return path;
}

export function loginHref(redirectTo: string, locale: string): string {
  const localizedRedirect = localizedPath(redirectTo, locale);
  return `/login?redirect=${encodeURIComponent(localizedRedirect)}`;
}

export function loginPath(redirectTo: string, locale: string): string {
  return localizedPath(loginHref(redirectTo, locale), locale);
}
