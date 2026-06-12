export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const STORAGE_KEY = "jtpa-theme";

export function coerceThemeMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

export function resolveStoredTheme(
  storedValue: string | null,
  prefersDark: boolean,
): ResolvedTheme {
  const mode = coerceThemeMode(storedValue);
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function applyThemeClass(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function syncThemeClassFromStorage() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const resolved = resolveStoredTheme(
    window.localStorage.getItem(STORAGE_KEY),
    window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  applyThemeClass(resolved);
}
