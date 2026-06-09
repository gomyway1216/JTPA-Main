import { toDate } from "@/lib/utils";
import type { TsLike } from "@/lib/types";

export const DEFAULT_CHECKIN_EARLY_MINUTES = 4 * 60;
export const DEFAULT_CHECKIN_LATE_MINUTES = 6 * 60;
export const MAX_CHECKIN_WINDOW_MINUTES = 7 * 24 * 60;

// Default window for older events without per-event settings.
export const CHECKIN_EARLY_MS = DEFAULT_CHECKIN_EARLY_MINUTES * 60 * 1000;

// Default late buffer for older events without per-event settings.
export const CHECKIN_LATE_MS = DEFAULT_CHECKIN_LATE_MINUTES * 60 * 1000;

export type CheckInWindowReason =
  | "ok"
  | "too_early"
  | "too_late"
  | "missing_dates";

type CheckInWindowConfig = {
  checkInEarlyMinutes?: unknown;
  checkInLateMinutes?: unknown;
};

function normalizeWindowMinutes(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const minutes = Math.trunc(value);
  if (minutes < 0 || minutes > MAX_CHECKIN_WINDOW_MINUTES) return fallback;
  return minutes;
}

export function checkInWindowSettings(event: CheckInWindowConfig = {}): {
  earlyMinutes: number;
  lateMinutes: number;
} {
  return {
    earlyMinutes: normalizeWindowMinutes(
      event.checkInEarlyMinutes,
      DEFAULT_CHECKIN_EARLY_MINUTES,
    ),
    lateMinutes: normalizeWindowMinutes(
      event.checkInLateMinutes,
      DEFAULT_CHECKIN_LATE_MINUTES,
    ),
  };
}

export function checkInWindowState(
  event: { startAt: TsLike; endAt: TsLike } & CheckInWindowConfig,
  now: Date = new Date(),
): CheckInWindowReason {
  const start = toDate(event.startAt);
  const end = toDate(event.endAt);
  if (!start || !end) return "missing_dates";
  const { earlyMinutes, lateMinutes } = checkInWindowSettings(event);
  const t = now.getTime();
  if (t < start.getTime() - earlyMinutes * 60 * 1000) return "too_early";
  if (t > end.getTime() + lateMinutes * 60 * 1000) return "too_late";
  return "ok";
}

// Length picks a balance: short enough to fit in a low-density QR code,
// long enough that brute-forcing the URL is infeasible in the day window.
// ~96 bits of entropy.
const TOKEN_LEN = 16;
const TOKEN_ALPHABET =
  "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateCheckInTokenString(): string {
  // Node has Web Crypto on globalThis since v19; the Admin SDK runs on
  // Node 20+ in this project, so this is safe.
  const bytes = new Uint8Array(TOKEN_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < TOKEN_LEN; i++) {
    out += TOKEN_ALPHABET[bytes[i] % TOKEN_ALPHABET.length];
  }
  return out;
}

export function buildCheckInUrl(
  origin: string,
  slug: string,
  token: string,
): string {
  const url = new URL(`/events/${slug}/checkin`, origin);
  url.searchParams.set("t", token);
  return url.toString();
}

function firstHeaderValue(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function isLocalHost(host: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(
      host.includes("://") ? host : `http://${host}`,
    ).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    hostname === "localhost" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function normalizeHttpOrigin(
  value: string | null | undefined,
  protocol?: "http" | "https",
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) return null;
  const normalized = hasScheme
    ? trimmed
    : `${protocol ?? (isLocalHost(trimmed) ? "http" : "https")}://${trimmed}`;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizedProtocol(
  value: string | null | undefined,
  host: string,
): "http" | "https" {
  const protocol = firstHeaderValue(value)?.toLowerCase().replace(/:$/, "");
  if (protocol === "http" || protocol === "https") return protocol;
  return isLocalHost(host) ? "http" : "https";
}

export function buildCheckInOrigin({
  explicitOrigin,
  forwardedHost,
  forwardedProto,
  host,
}: {
  explicitOrigin?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
  host?: string | null;
}): string | null {
  if (explicitOrigin?.trim()) return normalizeHttpOrigin(explicitOrigin);

  const resolvedHost = firstHeaderValue(forwardedHost) ?? firstHeaderValue(host);
  if (!resolvedHost) return null;

  return normalizeHttpOrigin(
    resolvedHost,
    normalizedProtocol(forwardedProto, resolvedHost),
  );
}
