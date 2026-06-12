import { syncThemeClassFromStorage } from "@/components/theme/theme-script";

try {
  syncThemeClassFromStorage();
} catch {
  // Theme initialization is best-effort; hydration will continue and the
  // ThemeProvider will retry once React mounts.
}
