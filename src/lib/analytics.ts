export type AnalyticsEventParams = Record<
  string,
  string | number | boolean | undefined
>;

type Gtag = (
  command: "config" | "event" | "js",
  targetOrName: string | Date,
  params?: AnalyticsEventParams,
) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

const GA_MEASUREMENT_ID = /^G-[A-Z0-9]+$/;

export function analyticsMeasurementId(
  raw = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
): string | null {
  const value = raw?.trim().toUpperCase();
  return value && GA_MEASUREMENT_ID.test(value) ? value : null;
}

export function googleAnalyticsInitScript(measurementId: string): string {
  const validated = analyticsMeasurementId(measurementId);
  if (!validated) return "";
  return `(function(){window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config','${validated}',{allow_google_signals:false,allow_ad_personalization_signals:false})})()`;
}

export function trackAnalyticsEvent(
  name: string,
  params: AnalyticsEventParams = {},
): boolean {
  if (typeof window === "undefined" || !window.gtag) return false;
  window.gtag("event", name, params);
  return true;
}

export function trackRsvpComplete({
  eventSlug,
  role,
  status,
}: {
  eventSlug: string;
  role: "attendee" | "presenter";
  status: "confirmed" | "waitlist";
}): boolean {
  return trackAnalyticsEvent("rsvp_complete", {
    event_slug: eventSlug,
    participation_role: role,
    registration_status: status,
  });
}
