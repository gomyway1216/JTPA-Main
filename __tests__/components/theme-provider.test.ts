import { describe, expect, it } from "vitest";

import { resolveStoredTheme } from "@/components/theme/theme-script";

type StoredTheme = "light" | "dark" | "system" | null;

function resolveTestTheme({
  storedTheme,
  prefersDark,
}: {
  storedTheme: StoredTheme;
  prefersDark: boolean;
}) {
  return resolveStoredTheme(storedTheme, prefersDark);
}

describe("resolveStoredTheme", () => {
  it("uses the system preference when no theme has been stored yet", () => {
    expect(resolveTestTheme({ storedTheme: null, prefersDark: true })).toBe(
      "dark",
    );
    expect(resolveTestTheme({ storedTheme: null, prefersDark: false })).toBe(
      "light",
    );
  });

  it("uses the system dark preference when the stored mode is system", () => {
    expect(
      resolveTestTheme({ storedTheme: "system", prefersDark: true }),
    ).toBe("dark");
  });

  it("removes stale dark class when the resolved theme is light", () => {
    expect(
      resolveTestTheme({
        storedTheme: "system",
        prefersDark: false,
      }),
    ).toBe("light");
  });

  it("lets explicit light override a dark system preference", () => {
    expect(
      resolveTestTheme({
        storedTheme: "light",
        prefersDark: true,
      }),
    ).toBe("light");
  });

  it("lets explicit dark override a light system preference", () => {
    expect(
      resolveTestTheme({ storedTheme: "dark", prefersDark: false }),
    ).toBe("dark");
  });
});
