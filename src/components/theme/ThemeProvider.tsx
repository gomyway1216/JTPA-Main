"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";

import {
  applyThemeClass,
  coerceThemeMode,
  STORAGE_KEY,
  syncThemeClassFromStorage,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme-script";

export type { ThemeMode };

// Module-level store. `useSyncExternalStore` is the React-19-idiomatic
// way to read client-only state (localStorage, matchMedia) without
// triggering cascading effects on mount and without SSR/CSR hydration
// drift. Server snapshot is always "system" — instrumentation-client.ts
// and this provider sync the actual `.dark` class on the client.

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
  cachedMode = coerceThemeMode(v);
  return cachedMode;
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveFor(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

function notify() {
  for (const cb of listeners) cb();
}

function attachGlobalListeners(): () => void {
  syncThemeClassFromStorage();

  // Cross-tab sync: another tab wrote a new theme preference.
  const storageHandler = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    cachedMode = null;
    syncThemeClassFromStorage();
    notify();
  };
  // OS-level theme change — only matters while we're in "system" mode.
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const mqHandler = () => {
    if (readStored() !== "system") return;
    syncThemeClassFromStorage();
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
  applyThemeClass(resolveFor(next));
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

const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Locale changes can re-apply the server-rendered <html> className,
  // which does not know about localStorage or matchMedia. Reassert the
  // client theme whenever this provider mounts or the stored mode changes.
  useIsomorphicLayoutEffect(() => {
    syncThemeClassFromStorage();
  }, [mode]);

  return <>{children}</>;
}
