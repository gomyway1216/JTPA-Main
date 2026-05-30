import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ja", "en"],
  defaultLocale: "ja",
  localeDetection: false,
  localePrefix: "as-needed",
});

export type AppLocale = (typeof routing.locales)[number];
