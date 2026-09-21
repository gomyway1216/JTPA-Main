import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import en from "../../messages/en.json";
import ja from "../../messages/ja.json";

const context = vi.hoisted(() => ({ locale: "ja" as "ja" | "en" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: keyof typeof ja.ReaderNextSteps) =>
    (context.locale === "ja" ? ja : en).ReaderNextSteps[key],
}));
vi.mock("@/i18n/navigation", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) =>
    createElement("a", { href: `/${context.locale}${href}` }, children),
}));

import { ReaderNextSteps } from "@/components/community/ReaderNextSteps";

describe("ReaderNextSteps", () => {
  it.each(["ja", "en"] as const)("offers crawlable participation and reading links in %s", async (locale) => {
    context.locale = locale;
    const html = renderToStaticMarkup(await ReaderNextSteps());
    expect(html).toContain(`href="/${locale}/events"`);
    expect(html).toContain(`href="/${locale}/guide"`);
    expect(html).toContain(`href="/${locale}/mailing-list"`);
    expect(html).not.toContain("/login");
    expect(html).toContain((locale === "ja" ? ja : en).ReaderNextSteps.title);
  });
});
