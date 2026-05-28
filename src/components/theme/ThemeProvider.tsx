"use client";

import { useSyncExternalStore } from "react";

export type ThemeMode = "light" | "dark" | "system";
const STORAGE_KEY = "jtpa-theme";

// Module-level store. `useSyncExternalStore` is the React-19-idiomatic
// way to read client-only state (localStorage, matchMedia) without
// triggering cascading effects on mount and without SSR/CSR hydration
// drift. Server snapshot is always "system" — the inline script in
// layout.tsx already set the actual `.dark` class before hydration.

const listeners = new Set<() => void>();

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveFor(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

function applyClass(resolved: "light" | "dark") {
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab sync: when localStorage changes from another tab.
  const storageHandler = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      applyClass(resolveFor(readStored()));
      cb();
    }
  };
  // System theme change — only matters when mode is "system", but we
  // recompute resolved on every fire anyway and let consumers re-render.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const mqHandler = () => {
    if (readStored() === "system") {
      applyClass(resolveFor("system"));
      cb();
    }
  };
  window.addEventListener("storage", storageHandler);
  mq.addEventListener("change", mqHandler);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", storageHandler);
    mq.removeEventListener("change", mqHandler);
  };
}

function getSnapshot(): ThemeMode {
  return readStored();
}

function getServerSnapshot(): ThemeMode {
  return "system";
}

export function setMode(next: ThemeMode) {
  window.localStorage.setItem(STORAGE_KEY, next);
  applyClass(resolveFor(next));
  for (const cb of listeners) cb();
}

export function useTheme(): {
  mode: ThemeMode;
  setMode: typeof setMode;
  resolved: "light" | "dark";
} {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolveFor(readStored()),
    () => "light" as const,
  );
  return { mode, setMode, resolved };
}

// Inline blocking script run in <head> before paint. Reads localStorage
// and sets `.dark` on <html> synchronously so users don't see a flash of
// the wrong theme. Kept as a string so we can dangerouslySetInnerHTML it
// into the layout — must stay tiny.
export const THEME_INIT_SCRIPT = `(function(){try{var k='${STORAGE_KEY}';var v=localStorage.getItem(k);var d=(v==='dark')||((v===null||v==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

// Kept for backwards-compat in case any caller imports it; ThemeProvider
// no longer needs to render anything since the store is module-level.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
