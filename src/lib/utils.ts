import type { TsLike } from "@/lib/types";

export function toDate(value: TsLike | undefined | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: () => Date }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof (value as { seconds?: number }).seconds === "number") {
    const v = value as { seconds: number; nanoseconds: number };
    return new Date(v.seconds * 1000 + Math.floor(v.nanoseconds / 1e6));
  }
  return null;
}

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
});

const timeFormatter = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDate(value: TsLike | undefined | null): string {
  const d = toDate(value);
  return d ? dateFormatter.format(d) : "";
}

export function formatDateTime(value: TsLike | undefined | null): string {
  const d = toDate(value);
  return d ? `${dateFormatter.format(d)} ${timeFormatter.format(d)}` : "";
}

export function formatTime(value: TsLike | undefined | null): string {
  const d = toDate(value);
  return d ? timeFormatter.format(d) : "";
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
