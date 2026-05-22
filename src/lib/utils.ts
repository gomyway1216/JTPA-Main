import type { TsLike } from "@/lib/types";

export function toDate(value: TsLike | undefined | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const obj = value as Record<string, unknown>;
  if (typeof obj.toDate === "function") {
    return (obj.toDate as () => Date)();
  }
  if (typeof obj.seconds === "number") {
    return new Date(
      (obj.seconds as number) * 1000 +
        Math.floor((obj.nanoseconds as number) / 1e6),
    );
  }
  if (typeof obj._seconds === "number") {
    return new Date(
      (obj._seconds as number) * 1000 +
        Math.floor((obj._nanoseconds as number) / 1e6),
    );
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
  const cleaned = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  // Japanese/CJK-only titles strip to empty — fall back to a base36 timestamp
  // so the slug always satisfies the min(2) regex requirement.
  if (cleaned.length < 2) {
    return `event-${Date.now().toString(36)}`;
  }
  return cleaned;
}

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}
