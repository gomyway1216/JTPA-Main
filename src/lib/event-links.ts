import type { EventDoc } from "@/lib/types";
import { eventCardSummary, toDate } from "@/lib/utils";

type ShareableEvent = Pick<
  EventDoc,
  "title" | "summary" | "description" | "startAt" | "endAt" | "location"
>;

function googleCalendarDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function googleCalendarUrl(
  event: ShareableEvent,
  eventUrl: string,
): string | null {
  const start = toDate(event.startAt);
  const end = toDate(event.endAt);
  if (!start || !end) return null;

  const url = new URL("https://calendar.google.com/calendar/render");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", event.title);
  url.searchParams.set(
    "dates",
    `${googleCalendarDate(start)}/${googleCalendarDate(end)}`,
  );
  url.searchParams.set(
    "details",
    `${eventCardSummary(event)}\n\n${eventUrl}`,
  );
  if (event.location.address) {
    url.searchParams.set("location", event.location.address);
  }
  return url.toString();
}

export function facebookShareUrl(eventUrl: string): string {
  const url = new URL("https://www.facebook.com/sharer/sharer.php");
  url.searchParams.set("u", eventUrl);
  return url.toString();
}

export function emailShareUrl(title: string, eventUrl: string): string {
  const params = new URLSearchParams({
    subject: title,
    body: `${title}\n${eventUrl}`,
  });
  return `mailto:?${params.toString()}`;
}
