"use client";

import { useState } from "react";

import { PresentationSection } from "@/app/[locale]/events/[slug]/PresentationSection";
import { RsvpSection } from "@/app/[locale]/events/[slug]/RsvpSection";
import type { PublicProfile } from "@/lib/data/users";
import type {
  EventDoc,
  PresentationDoc,
  RsvpDoc,
  SessionUser,
} from "@/lib/types";

export function EventInteractionSections({
  event,
  initialRsvp,
  user,
  profileAffiliation,
  initialPresentations,
  presenterProfiles,
}: {
  event: EventDoc;
  initialRsvp: RsvpDoc | null;
  user: SessionUser;
  profileAffiliation: string;
  initialPresentations: PresentationDoc[];
  presenterProfiles: Record<string, PublicProfile>;
}) {
  const [rsvp, setRsvp] = useState<RsvpDoc | null>(initialRsvp);

  return (
    <>
      <RsvpSection
        event={event}
        initialRsvp={initialRsvp}
        user={user}
        profileAffiliation={profileAffiliation}
        onRsvpChange={setRsvp}
      />
      <PresentationSection
        eventId={event.id}
        eventSlug={event.slug}
        user={user}
        myRsvp={rsvp}
        initialPresentations={initialPresentations}
        presenterProfiles={presenterProfiles}
      />
    </>
  );
}
