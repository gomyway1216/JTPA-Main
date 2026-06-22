import type { AppLocale } from "@/i18n/routing";

export const CONTENT_LOCALES = ["ja", "en"] as const satisfies readonly AppLocale[];
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export const DEFAULT_CONTENT_LOCALE = "ja" satisfies ContentLocale;

export function isContentLocale(value: unknown): value is ContentLocale {
  return (
    typeof value === "string" &&
    (CONTENT_LOCALES as readonly string[]).includes(value)
  );
}

export function normalizeContentLocales(
  values: readonly unknown[] | undefined,
): ContentLocale[] {
  if (!values) return [];

  const out: ContentLocale[] = [];
  for (const value of values) {
    if (!isContentLocale(value) || out.includes(value)) continue;
    out.push(value);
  }
  return out;
}

export function initialContentLocales(
  values: readonly unknown[] | undefined,
  fallbackLocale: string,
): ContentLocale[] {
  const normalized = normalizeContentLocales(values);
  if (normalized.length > 0) return normalized;
  return [isContentLocale(fallbackLocale) ? fallbackLocale : DEFAULT_CONTENT_LOCALE];
}

export function contentMatchesLocale(
  values: readonly unknown[] | undefined,
  locale: string | undefined,
): boolean {
  const normalized = normalizeContentLocales(values);
  if (normalized.length === 0 || !isContentLocale(locale)) return true;
  return normalized.includes(locale);
}
