import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVENT_TIME_ZONE,
  dateTimeLocalToDate,
  dateToDateTimeLocal,
  eventTimeZone,
  formatTimeZoneName,
  isValidTimeZone,
} from "@/lib/time-zones";

describe("event time zone helpers", () => {
  it("validates IANA time zones", () => {
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
  });

  it("falls back to the Bay Area event time zone for legacy docs", () => {
    expect(eventTimeZone({})).toBe(DEFAULT_EVENT_TIME_ZONE);
    expect(eventTimeZone({ timeZone: "Mars/Olympus_Mons" })).toBe(
      DEFAULT_EVENT_TIME_ZONE,
    );
    expect(eventTimeZone({ timeZone: "Asia/Tokyo" })).toBe("Asia/Tokyo");
  });

  it("interprets datetime-local input in the selected event time zone", () => {
    expect(
      dateTimeLocalToDate(
        "2026-06-24T17:30",
        "America/Los_Angeles",
      )?.toISOString(),
    ).toBe("2026-06-25T00:30:00.000Z");
    expect(
      dateTimeLocalToDate(
        "2026-06-24T17:30",
        "America/Chicago",
      )?.toISOString(),
    ).toBe("2026-06-24T22:30:00.000Z");
  });

  it("formats stored UTC instants back into datetime-local values", () => {
    const value = new Date("2026-06-25T00:30:00.000Z");
    expect(dateToDateTimeLocal(value, "America/Los_Angeles")).toBe(
      "2026-06-24T17:30",
    );
    expect(dateToDateTimeLocal(value, "Asia/Tokyo")).toBe("2026-06-25T09:30");
  });

  it("rejects invalid calendar dates and DST gap times", () => {
    expect(dateTimeLocalToDate("2026-02-31T17:30", "America/Los_Angeles")).toBeNull();
    expect(dateTimeLocalToDate("2026-03-08T02:30", "America/Los_Angeles")).toBeNull();
  });

  it("returns a displayable time zone name", () => {
    expect(
      formatTimeZoneName(
        new Date("2026-06-25T00:30:00.000Z"),
        "en-US",
        "America/Los_Angeles",
      ),
    ).toBeTruthy();
  });
});
