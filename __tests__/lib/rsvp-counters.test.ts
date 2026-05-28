import { describe, expect, it } from "vitest";

import { cancellationDeltas } from "@/lib/rsvp-counters";

describe("cancellationDeltas", () => {
  describe("confirmed canceller, no promotee available", () => {
    it("attendee: just frees one seat", () => {
      expect(
        cancellationDeltas({
          priorStatus: "confirmed",
          priorRole: "attendee",
          promoteeRole: null,
        }),
      ).toEqual({ rsvpDelta: -1, waitlistDelta: 0, presenterDelta: 0 });
    });

    it("presenter: frees one seat AND decrements presenter count", () => {
      expect(
        cancellationDeltas({
          priorStatus: "confirmed",
          priorRole: "presenter",
          promoteeRole: null,
        }),
      ).toEqual({ rsvpDelta: -1, waitlistDelta: 0, presenterDelta: -1 });
    });
  });

  describe("confirmed canceller, with promotee (net-zero seat)", () => {
    it("attendee canceller + attendee promotee: rsvp stays the same", () => {
      expect(
        cancellationDeltas({
          priorStatus: "confirmed",
          priorRole: "attendee",
          promoteeRole: "attendee",
        }),
      ).toEqual({ rsvpDelta: 0, waitlistDelta: -1, presenterDelta: 0 });
    });

    it("attendee canceller + presenter promotee: presenter count gains one", () => {
      expect(
        cancellationDeltas({
          priorStatus: "confirmed",
          priorRole: "attendee",
          promoteeRole: "presenter",
        }),
      ).toEqual({ rsvpDelta: 0, waitlistDelta: -1, presenterDelta: 1 });
    });

    it("presenter canceller + attendee promotee: presenter count drops", () => {
      expect(
        cancellationDeltas({
          priorStatus: "confirmed",
          priorRole: "presenter",
          promoteeRole: "attendee",
        }),
      ).toEqual({ rsvpDelta: 0, waitlistDelta: -1, presenterDelta: -1 });
    });

    it("presenter canceller + presenter promotee: presenter count unchanged", () => {
      expect(
        cancellationDeltas({
          priorStatus: "confirmed",
          priorRole: "presenter",
          promoteeRole: "presenter",
        }),
      ).toEqual({ rsvpDelta: 0, waitlistDelta: -1, presenterDelta: 0 });
    });
  });

  describe("waitlist canceller (never promotes)", () => {
    // A waitlist canceller is leaving the waitlist itself, not freeing
    // a confirmed seat — so no promotion can happen even if there are
    // other waitlisted users behind them. (cancelRsvp enforces this by
    // skipping the waitlist query when prior.status !== 'confirmed';
    // the helper assumes the caller respects that invariant.)
    it("attendee: just shrinks the waitlist", () => {
      expect(
        cancellationDeltas({
          priorStatus: "waitlist",
          priorRole: "attendee",
          promoteeRole: null,
        }),
      ).toEqual({ rsvpDelta: 0, waitlistDelta: -1, presenterDelta: 0 });
    });

    it("presenter: same — presenterCount only tracks CONFIRMED presenters", () => {
      expect(
        cancellationDeltas({
          priorStatus: "waitlist",
          priorRole: "presenter",
          promoteeRole: null,
        }),
      ).toEqual({ rsvpDelta: 0, waitlistDelta: -1, presenterDelta: 0 });
    });
  });
});
