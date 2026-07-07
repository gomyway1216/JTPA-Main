import type { EventDoc, PostDoc } from "@/lib/types";

export function eventReportSlug(
  event: Pick<EventDoc, "reportPostSlug">,
): string | null {
  const slug = event.reportPostSlug?.trim();
  return slug ? slug : null;
}

export function reportPostForEvent<T extends Pick<PostDoc, "slug">>(
  postsBySlug: ReadonlyMap<string, T>,
  event: Pick<EventDoc, "reportPostSlug">,
): T | null {
  const slug = eventReportSlug(event);
  return slug ? postsBySlug.get(slug) ?? null : null;
}
