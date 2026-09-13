import { describe, expect, it } from "vitest";

import {
  emailShareUrl,
  facebookShareUrl,
  googleCalendarUrl,
} from "@/lib/event-links";

const event = {
  title: "Bay Area AI Study Group",
  summary: "A practical AI meetup",
  description: "## Longer description",
  startAt: "2026-10-03T00:30:00.000Z",
  endAt: "2026-10-03T03:00:00.000Z",
  location: {
    type: "offline" as const,
    address: "3979 Freedom Cir, Santa Clara, CA",
  },
};

describe("googleCalendarUrl", () => {
  it("builds a UTC calendar template with event details", () => {
    const value = googleCalendarUrl(
      event,
      "https://bayarea-ai.com/ja/events/ai5",
    );
    expect(value).not.toBeNull();

    const url = new URL(value!);
    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe(event.title);
    expect(url.searchParams.get("dates")).toBe(
      "20261003T003000Z/20261003T030000Z",
    );
    expect(url.searchParams.get("details")).toContain(
      "https://bayarea-ai.com/ja/events/ai5",
    );
    expect(url.searchParams.get("location")).toBe(event.location.address);
  });

  it("returns null when an event date is invalid", () => {
    expect(
      googleCalendarUrl(
        { ...event, startAt: "not-a-date" },
        "https://bayarea-ai.com/ja/events/ai5",
      ),
    ).toBeNull();
  });
});

describe("event share links", () => {
  it("encodes the event URL for Facebook", () => {
    const shared = "https://bayarea-ai.com/ja/events/ai5";
    const url = new URL(facebookShareUrl(shared));
    expect(url.searchParams.get("u")).toBe(shared);
  });

  it("includes the title and URL in an email draft", () => {
    const value = emailShareUrl(
      event.title,
      "https://bayarea-ai.com/ja/events/ai5",
    );
    expect(value).toContain("subject=Bay+Area+AI+Study+Group");
    expect(value).toContain("https%3A%2F%2Fbayarea-ai.com%2Fja%2Fevents%2Fai5");
  });
});
