import { describe, expect, it } from "vitest";
import QRCode from "qrcode";

import {
  CHECKIN_EARLY_MS,
  CHECKIN_LATE_MS,
  buildCheckInOrigin,
  buildCheckInUrl,
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

  it("uses per-event check-in windows when present", () => {
    const customEvent = {
      ...event,
      checkInEarlyMinutes: 30,
      checkInLateMinutes: 15,
    };

    expect(
      checkInWindowState(
        customEvent,
        new Date(start.getTime() - 30 * 60 * 1000),
      ),
    ).toBe("ok");
    expect(
      checkInWindowState(
        customEvent,
        new Date(start.getTime() - 30 * 60 * 1000 - 1),
      ),
    ).toBe("too_early");
    expect(
      checkInWindowState(
        customEvent,
        new Date(end.getTime() + 15 * 60 * 1000),
      ),
    ).toBe("ok");
    expect(
      checkInWindowState(
        customEvent,
        new Date(end.getTime() + 15 * 60 * 1000 + 1),
      ),
    ).toBe("too_late");
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

describe("buildCheckInOrigin", () => {
  it("uses an explicit configured origin when present", () => {
    expect(
      buildCheckInOrigin({
        explicitOrigin: "https://bayarea-ai.com",
        forwardedHost: "preview.example.com",
        forwardedProto: "https",
        host: "internal.run.app",
      }),
    ).toBe("https://bayarea-ai.com");
  });

  it("normalizes an explicit configured origin without a protocol", () => {
    expect(buildCheckInOrigin({ explicitOrigin: "bayarea-ai.com" })).toBe(
      "https://bayarea-ai.com",
    );
    expect(buildCheckInOrigin({ explicitOrigin: "localhost:3001" })).toBe(
      "http://localhost:3001",
    );
  });

  it("rejects invalid explicit origins instead of crashing later", () => {
    expect(
      buildCheckInOrigin({ explicitOrigin: "ftp://bayarea-ai.com" }),
    ).toBeNull();
  });

  it("prefers x-forwarded-host over the internal request host", () => {
    expect(
      buildCheckInOrigin({
        forwardedHost: "bayarea-ai.com",
        forwardedProto: "https",
        host: "t-233178595---jtpa-main-2ssrziw5oq-uc.a.run.app",
      }),
    ).toBe("https://bayarea-ai.com");
  });

  it("uses the first value from comma-separated forwarded headers", () => {
    expect(
      buildCheckInOrigin({
        forwardedHost: "bayarea-ai.com, internal.run.app",
        forwardedProto: "https, http",
        host: "internal.run.app",
      }),
    ).toBe("https://bayarea-ai.com");
  });

  it("falls back to the request host for local development", () => {
    expect(buildCheckInOrigin({ host: "localhost:3001" })).toBe(
      "http://localhost:3001",
    );
  });

  it("does not treat public localhost-like host names as local", () => {
    expect(buildCheckInOrigin({ host: "localhost-staging.com" })).toBe(
      "https://localhost-staging.com",
    );
    expect(buildCheckInOrigin({ host: "127.0.0.1.example.com" })).toBe(
      "https://127.0.0.1.example.com",
    );
  });

  it("normalizes invalid forwarded protocol values", () => {
    expect(
      buildCheckInOrigin({
        forwardedHost: "bayarea-ai.com",
        forwardedProto: "javascript",
        host: "internal.run.app",
      }),
    ).toBe("https://bayarea-ai.com");
  });

  it("rejects invalid forwarded host values", () => {
    expect(
      buildCheckInOrigin({
        forwardedHost: "bad host",
        forwardedProto: "https",
        host: "internal.run.app",
      }),
    ).toBeNull();
  });

  it("returns null when no origin can be resolved", () => {
    expect(buildCheckInOrigin({})).toBeNull();
  });
});

describe("buildCheckInUrl", () => {
  it("builds the QR payload URL from origin, slug, and token", () => {
    expect(
      buildCheckInUrl("https://bayarea-ai.com", "ai-study-2", "abc123"),
    ).toBe("https://bayarea-ai.com/events/ai-study-2/checkin?t=abc123");
  });

  it("normalizes trailing slashes and URL-encodes path/query values", () => {
    const url = buildCheckInUrl(
      "https://bayarea-ai.com/",
      "ai 勉強会",
      "a+b&c",
    );

    expect(url).toBe(
      "https://bayarea-ai.com/events/ai%20%E5%8B%89%E5%BC%B7%E4%BC%9A/checkin?t=a%2Bb%26c",
    );
  });

  it("can be rendered as a QR-code SVG", async () => {
    const payload = buildCheckInUrl(
      "https://bayarea-ai.com",
      "ai-study-2",
      "abc123",
    );
    const svg = await QRCode.toString(payload, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    });

    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });
});
