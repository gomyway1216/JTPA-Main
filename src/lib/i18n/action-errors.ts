import { getLocale } from "next-intl/server";

import { routing, type AppLocale } from "@/i18n/routing";

import enMessages from "../../../messages/en.json";
import jaMessages from "../../../messages/ja.json";

const actionErrorsByLocale = {
  en: enMessages.ActionErrors,
  ja: jaMessages.ActionErrors,
};

export type ActionErrorKey = keyof typeof jaMessages.ActionErrors;
export type ActionErrorValues = Record<
  string,
  string | number | boolean | null | undefined
>;

function isAppLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

async function getActionLocale(): Promise<AppLocale> {
  try {
    const locale = await getLocale();
    if (isAppLocale(locale)) return locale;
  } catch {
    // Unit tests and direct server-side invocations can run without a
    // next-intl request context. Preserve the app's default language there.
  }
  return routing.defaultLocale;
}

export function formatZodIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string {
  return issues
    .map((issue) => {
      const path = issue.path.map(String).join(".") || "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function formatActionError(
  locale: AppLocale,
  key: ActionErrorKey,
  values: ActionErrorValues = {},
): string {
  const template =
    actionErrorsByLocale[locale][key] ??
    actionErrorsByLocale[routing.defaultLocale][key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined || value === null ? match : String(value);
  });
}

export async function actionError(
  key: ActionErrorKey,
  values?: ActionErrorValues,
): Promise<string> {
  return formatActionError(await getActionLocale(), key, values);
}

export async function inputError(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Promise<string> {
  return actionError("input", { issues: formatZodIssues(issues) });
}
