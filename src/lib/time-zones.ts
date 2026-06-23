import type { TsLike } from "@/lib/types";
import { toDate } from "@/lib/utils";

export const DEFAULT_EVENT_TIME_ZONE = "America/Los_Angeles";
export const JAPAN_TIME_ZONE = "Asia/Tokyo";

export const EVENT_TIME_ZONE_OPTIONS = [
  { value: "America/Los_Angeles", labelKey: "pacific" },
  { value: "America/Chicago", labelKey: "central" },
  { value: "America/New_York", labelKey: "eastern" },
  { value: "Asia/Tokyo", labelKey: "japan" },
  { value: "UTC", labelKey: "utc" },
] as const;

const DATE_TIME_LOCAL_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const zonedPartsFormatterCache = new Map<string, Intl.DateTimeFormat>();
const timeZoneNameFormatterCache = new Map<string, Intl.DateTimeFormat>();
const timeZoneValidityCache = new Map<string, boolean>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedPartsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      calendar: "iso8601",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zonedPartsFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function formatterCacheKey(
  locale: Intl.LocalesArgument,
  timeZone: string,
): string {
  return `${Array.isArray(locale) ? locale.join(",") : (locale ?? "ja-JP")}|${timeZone}`;
}

export function isValidTimeZone(timeZone: string): boolean {
  const cached = timeZoneValidityCache.get(timeZone);
  if (cached !== undefined) return cached;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date(0));
    timeZoneValidityCache.set(timeZone, true);
    return true;
  } catch {
    timeZoneValidityCache.set(timeZone, false);
    return false;
  }
}

export function eventTimeZone(
  event: { timeZone?: string | null } | undefined | null,
): string {
  const timeZone = event?.timeZone;
  return typeof timeZone === "string" && isValidTimeZone(timeZone)
    ? timeZone
    : DEFAULT_EVENT_TIME_ZONE;
}

function zonedParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function offsetMsAt(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return localAsUtc - date.getTime();
}

function parseDateTimeLocal(value: string) {
  const match = DATE_TIME_LOCAL_RE.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const parsed = {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
  };
  const utc = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
  );
  const check = new Date(utc);
  if (
    check.getUTCFullYear() !== parsed.year ||
    check.getUTCMonth() !== parsed.month - 1 ||
    check.getUTCDate() !== parsed.day ||
    check.getUTCHours() !== parsed.hour ||
    check.getUTCMinutes() !== parsed.minute
  ) {
    return null;
  }
  return parsed;
}

export function dateTimeLocalToDate(
  value: string,
  timeZone: string,
): Date | null {
  if (!isValidTimeZone(timeZone)) return null;
  const parts = parseDateTimeLocal(value);
  if (!parts) return null;

  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
  );
  let utcMs = localAsUtc - offsetMsAt(new Date(localAsUtc), timeZone);
  utcMs = localAsUtc - offsetMsAt(new Date(utcMs), timeZone);

  const date = new Date(utcMs);
  const check = zonedParts(date, timeZone);
  if (
    check.year !== parts.year ||
    check.month !== parts.month ||
    check.day !== parts.day ||
    check.hour !== parts.hour ||
    check.minute !== parts.minute
  ) {
    return null;
  }
  return date;
}

export function dateToDateTimeLocal(
  value: TsLike | undefined | null,
  timeZone: string,
): string {
  const date = toDate(value);
  if (!date || !isValidTimeZone(timeZone)) return "";
  const parts = zonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatTimeZoneName(
  value: TsLike | undefined | null,
  locale: Intl.LocalesArgument,
  timeZone: string,
): string {
  const date = toDate(value);
  if (!date || !isValidTimeZone(timeZone)) return "";
  const key = formatterCacheKey(locale, timeZone);
  let formatter = timeZoneNameFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "short",
    });
    timeZoneNameFormatterCache.set(key, formatter);
  }
  return (
    formatter.formatToParts(date).find((part) => part.type === "timeZoneName")
      ?.value ?? ""
  );
}
