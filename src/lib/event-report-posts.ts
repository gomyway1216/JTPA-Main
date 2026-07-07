import "server-only";

import { getPostBySlugCached } from "@/lib/data/cached";
import { eventReportSlug } from "@/lib/event-report-utils";
import type { EventDoc, PostDoc } from "@/lib/types";

export async function publishedReportPostsBySlug(
  events: ReadonlyArray<Pick<EventDoc, "reportPostSlug">>,
): Promise<Map<string, PostDoc>> {
  const slugs = Array.from(
    new Set(
      events
        .map((event) => eventReportSlug(event))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  );
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const post = await getPostBySlugCached(slug).catch(() => null);
      if (post?.status !== "published") return null;
      return [slug, post] as const;
    }),
  );
  return new Map(
    entries.filter((entry): entry is readonly [string, PostDoc] =>
      Boolean(entry),
    ),
  );
}
