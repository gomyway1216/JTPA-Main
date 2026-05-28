import { describe, expect, it } from "vitest";

import {
  CHECKIN_EARLY_MS,
  CHECKIN_LATE_MS,
  checkInWindowState,
  generateCheckInTokenString,
} from "@/lib/check-in";

const start = new Date("2026-05-27T18:00:00.000Z");
const end = new Date("2026-05-27T20:00:00.000Z");
const event = { startAt: start, endAt: end };

describe("checkInWindowState", () => {
  it("rejects times before the early-arrival window", () => {
    const now = new Date(start.getTime() - CHECKIN_EARLY_MS - 1);
    expect(checkInWindowState(event, now)).toBe("too_early");
  });

  it("accepts the exact start of the early-arrival window", () => {
    const now = new Date(start.getTime() - CHECKIN_EARLY_MS);
    expect(checkInWindowState(event, now)).toBe("ok");
  });

  it("accepts a time during the event", () => {
    const now = new Date(start.getTime() + 30 * 60 * 1000);
    expect(checkInWindowState(event, now)).toBe("ok");
  });

  it("accepts the exact end of the late-arrival window", () => {
    const now = new Date(end.getTime() + CHECKIN_LATE_MS);
    expect(checkInWindowState(event, now)).toBe("ok");
  });

  it("rejects times after the late-arrival window", () => {
    const now = new Date(end.getTime() + CHECKIN_LATE_MS + 1);
    expect(checkInWindowState(event, now)).toBe("too_late");
  });

  it("returns missing_dates when dates are unparseable", () => {
    expect(
      checkInWindowState({
        startAt: "not-a-date" as unknown as Date,
        endAt: "also-not" as unknown as Date,
      }),
    ).toBe("missing_dates");
  });
});

describe("generateCheckInTokenString", () => {
  it("produces 16-char tokens of unambiguous URL-safe characters", () => {
    const token = generateCheckInTokenString();
    expect(token).toHaveLength(16);
    // No 0/O/1/l/I — avoid hard-to-read characters if anyone reads it
    // aloud at the venue.
    expect(token).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
  });

  it("returns distinct tokens on repeated calls", () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => generateCheckInTokenString()),
    );
    // Collisions in 50 draws from a 56^16 space are vanishingly unlikely;
    // any duplicate here would indicate the RNG isn't being seeded.
    expect(tokens.size).toBe(50);
  });
});
