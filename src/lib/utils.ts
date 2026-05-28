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

export function slugify(input: string, fallbackPrefix = "event"): string {
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
    return `${fallbackPrefix}-${Date.now().toString(36)}`;
  }
  return cleaned;
}

/**
 * True if the event has ended (its `endAt` is in the past) OR an admin
 * has explicitly flipped its status to `cancelled` or `past`.
 *
 * Used to gate the RSVP form and to surface "イベント終了" notices without
 * waiting for an admin to manually transition `status: "published"` → `"past"`
 * (issue #20). Status remains the source of truth for `draft` / `cancelled`.
 */
export function isEventEnded(event: {
  endAt: TsLike;
  status: string;
}): boolean {
  if (event.status === "past" || event.status === "cancelled") return true;
  const end = toDate(event.endAt);
  if (!end) return false;
  return end.getTime() < Date.now();
}

export function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

// Lightweight Markdown→plain-text strip for excerpts, meta descriptions,
// and other plaintext rendering of authored bodies. Not a full parser:
// covers fenced/inline code, image and link syntax, headings, and emphasis
// markers. Anything missed renders as raw Markdown — mildly ugly but
// never wrong.
export function stripMarkdown(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Truncate to AT MOST `max` characters, using a Unicode ellipsis when
// truncating so the final string never exceeds the budget. Tries to land
// on a word boundary; falls back to a hard cut (CJK has no spaces).
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // max=0 can't fit even the ellipsis. Without this guard the
  // `text.slice(0, -1)` below silently drops the cap and returns
  // `text.slice(0, -1) + "…"`, which exceeds the budget.
  if (max <= 0) return "";
  // Reserve one char for the ellipsis so we honor the cap.
  const budget = max - 1;
  const cut = text.slice(0, budget);
  const space = cut.lastIndexOf(" ");
  return (space > budget * 0.6 ? cut.slice(0, space) : cut) + "…";
}
