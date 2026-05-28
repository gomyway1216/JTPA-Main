import type { RsvpDoc } from "@/lib/types";

// Counter deltas for a cancellation event. Pulled out of `cancelRsvp` so
// the bucket arithmetic — which has eight non-trivial cases — gets its
// own unit-test surface and a future change can't silently shift counts
// off by one.
//
// Semantics: the canceller leaves their current bucket; if there's a
// promotee (which only happens when the canceller was confirmed and
// someone is waiting), the promotee leaves waitlist and joins confirmed.
//
//   prior=confirmed/attendee,  no promotee    : rsvp-1, waitlist 0,  presenter 0
//   prior=confirmed/presenter, no promotee    : rsvp-1, waitlist 0,  presenter-1
//   prior=confirmed/X,         promotee=Y     : rsvp 0, waitlist-1, presenter (X==P? -1 : 0) + (Y==P? +1 : 0)
//   prior=waitlist/X,          no promotee    : rsvp 0, waitlist-1, presenter 0
//
// Note: a waitlist canceller never triggers a promotion — the freed
// slot was on the waitlist itself, not in the confirmed pool, so no
// seat opens up to promote into.
export interface CancellationDeltas {
  rsvpDelta: number;
  waitlistDelta: number;
  presenterDelta: number;
}

export function cancellationDeltas(opts: {
  priorStatus: RsvpDoc["status"];
  priorRole: RsvpDoc["role"];
  promoteeRole: RsvpDoc["role"] | null;
}): CancellationDeltas {
  const { priorStatus, priorRole, promoteeRole } = opts;

  const wasConfirmed = priorStatus === "confirmed";
  const wasWaitlist = priorStatus === "waitlist";
  const hasPromotee = promoteeRole !== null;

  const rsvpDelta = (wasConfirmed ? -1 : 0) + (hasPromotee ? 1 : 0);
  const waitlistDelta = (wasWaitlist ? -1 : 0) + (hasPromotee ? -1 : 0);
  const presenterDelta =
    (wasConfirmed && priorRole === "presenter" ? -1 : 0) +
    (hasPromotee && promoteeRole === "presenter" ? 1 : 0);

  return { rsvpDelta, waitlistDelta, presenterDelta };
}
