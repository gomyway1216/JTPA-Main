import type { AppLocale } from "@/i18n/routing";

export const CONTENT_LOCALES = ["ja", "en"] as const satisfies readonly AppLocale[];
export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export const DEFAULT_CONTENT_LOCALES = [
  ...CONTENT_LOCALES,
] satisfies ContentLocale[];

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
): ContentLocale[] {
  const normalized = normalizeContentLocales(values);
  if (normalized.length > 0) return normalized;
  return [...DEFAULT_CONTENT_LOCALES];
}

export function preferredContentLocale(
  values: readonly unknown[] | undefined,
  locale: string | undefined,
): ContentLocale | undefined {
  if (values === undefined) {
    return isContentLocale(locale) ? locale : DEFAULT_CONTENT_LOCALES[0];
  }
  const normalized = normalizeContentLocales(values);
  if (normalized.length === 0) return undefined;
  return isContentLocale(locale) && normalized.includes(locale)
    ? locale
    : normalized[0];
}
