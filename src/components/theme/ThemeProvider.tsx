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
// Cached localStorage read. `useSyncExternalStore` calls getSnapshot
// frequently (every render of every consumer), and `localStorage.getItem`
// is a synchronous DOM API that can show up in profiling under heavy use.
// Invalidated to `null` whenever the underlying value might have changed
// (setMode, cross-tab storage event).
let cachedMode: ThemeMode | null = null;
// One pair of DOM listeners shared across all subscribers, attached only
// while at least one consumer is mounted.
let detachGlobal: (() => void) | null = null;

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "system";
  if (cachedMode !== null) return cachedMode;
  const v = window.localStorage.getItem(STORAGE_KEY);
  cachedMode = v === "light" || v === "dark" || v === "system" ? v : "system";
  return cachedMode;
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

function notify() {
  for (const cb of listeners) cb();
}

function attachGlobalListeners(): () => void {
  // Cross-tab sync: another tab wrote a new theme preference.
  const storageHandler = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    cachedMode = null;
    applyClass(resolveFor(readStored()));
    notify();
  };
  // OS-level theme change — only matters while we're in "system" mode.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const mqHandler = () => {
    if (readStored() !== "system") return;
    applyClass(resolveFor("system"));
    notify();
  };
  window.addEventListener("storage", storageHandler);
  mq.addEventListener("change", mqHandler);
  return () => {
    window.removeEventListener("storage", storageHandler);
    mq.removeEventListener("change", mqHandler);
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (listeners.size === 1) {
    detachGlobal = attachGlobalListeners();
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && detachGlobal) {
      detachGlobal();
      detachGlobal = null;
    }
  };
}

function getSnapshot(): ThemeMode {
  return readStored();
}

function getServerSnapshot(): ThemeMode {
  return "system";
}

function getResolvedSnapshot(): "light" | "dark" {
  return resolveFor(readStored());
}

function getServerResolvedSnapshot(): "light" | "dark" {
  return "light";
}

export function setMode(next: ThemeMode) {
  cachedMode = next;
  window.localStorage.setItem(STORAGE_KEY, next);
  applyClass(resolveFor(next));
  notify();
}

export function useTheme(): {
  mode: ThemeMode;
  setMode: typeof setMode;
  resolved: "light" | "dark";
} {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const resolved = useSyncExternalStore(
    subscribe,
    getResolvedSnapshot,
    getServerResolvedSnapshot,
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
