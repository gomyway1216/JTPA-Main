import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  analyticsMeasurementId,
  googleAnalyticsInitScript,
  trackAnalyticsEvent,
  trackRsvpComplete,
} from "@/lib/analytics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analyticsMeasurementId", () => {
  it("normalizes a valid GA4 measurement ID", () => {
    expect(analyticsMeasurementId(" g-wrft30wqmy ")).toBe("G-WRFT30WQMY");
  });

  it("disables analytics for missing or invalid IDs", () => {
    expect(analyticsMeasurementId("")).toBeNull();
    expect(analyticsMeasurementId("UA-1234")).toBeNull();
  });

  it("only creates an initialization script for a validated ID", () => {
    expect(googleAnalyticsInitScript("G-WRFT30WQMY")).toContain(
      "gtag('config','G-WRFT30WQMY'",
    );
    expect(googleAnalyticsInitScript("bad';alert(1)//")).toBe("");
  });

  it("initializes the data layer and queues the GA4 config command", () => {
    const context = { window: {} as { dataLayer?: unknown[] } };
    runInNewContext(googleAnalyticsInitScript("G-WRFT30WQMY"), context);

    expect(context.window.dataLayer).toHaveLength(2);
    const configCommand = Array.from(context.window.dataLayer![1] as ArrayLike<unknown>);
    expect(configCommand[0]).toBe("config");
    expect(configCommand[1]).toBe("G-WRFT30WQMY");
  });
});

describe("analytics events", () => {
  it("does nothing when gtag has not loaded", () => {
    vi.stubGlobal("window", {});
    expect(trackAnalyticsEvent("page_view")).toBe(false);
  });

  it("sends an anonymous RSVP conversion event", () => {
    const gtag = vi.fn();
    vi.stubGlobal("window", { gtag });

    expect(
      trackRsvpComplete({
        eventSlug: "ai5",
        role: "attendee",
        status: "confirmed",
      }),
    ).toBe(true);
    expect(gtag).toHaveBeenCalledWith("event", "rsvp_complete", {
      event_slug: "ai5",
      participation_role: "attendee",
      registration_status: "confirmed",
    });
  });
});
