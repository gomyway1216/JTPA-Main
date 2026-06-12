import { describe, expect, it } from "vitest";

import { THEME_INIT_SCRIPT } from "@/components/theme/ThemeProvider";

type StoredTheme = "light" | "dark" | "system" | null;

function runThemeInit({
  storedTheme,
  prefersDark,
  startsDark = false,
}: {
  storedTheme: StoredTheme;
  prefersDark: boolean;
  startsDark?: boolean;
}) {
  const classes = new Set(startsDark ? ["dark"] : []);
  const localStorage = {
    getItem(key: string) {
      expect(key).toBe("jtpa-theme");
      return storedTheme;
    },
  };
  const matchMedia = (query: string) => {
    expect(query).toBe("(prefers-color-scheme: dark)");
    return { matches: prefersDark };
  };
  const document = {
    documentElement: {
      classList: {
        toggle(name: string, force?: boolean) {
          if (force) classes.add(name);
          else classes.delete(name);
          return classes.has(name);
        },
      },
    },
  };

  Function("localStorage", "matchMedia", "document", THEME_INIT_SCRIPT)(
    localStorage,
    matchMedia,
    document,
  );

  return classes.has("dark");
}

describe("THEME_INIT_SCRIPT", () => {
  it("uses the system dark preference when the stored mode is system", () => {
    expect(
      runThemeInit({ storedTheme: "system", prefersDark: true }),
    ).toBe(true);
  });

  it("removes stale dark class when the resolved theme is light", () => {
    expect(
      runThemeInit({
        storedTheme: "system",
        prefersDark: false,
        startsDark: true,
      }),
    ).toBe(false);
  });

  it("lets explicit light override a dark system preference", () => {
    expect(
      runThemeInit({
        storedTheme: "light",
        prefersDark: true,
        startsDark: true,
      }),
    ).toBe(false);
  });

  it("lets explicit dark override a light system preference", () => {
    expect(
      runThemeInit({ storedTheme: "dark", prefersDark: false }),
    ).toBe(true);
  });
});
