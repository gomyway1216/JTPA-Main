import { describe, expect, it } from "vitest";

import {
  eventReportSlug,
  reportPostForEvent,
} from "@/lib/event-report-utils";

describe("event report helpers", () => {
  it("normalizes blank report slugs to null", () => {
    expect(eventReportSlug({ reportPostSlug: undefined })).toBeNull();
    expect(eventReportSlug({ reportPostSlug: "   " })).toBeNull();
  });

  it("looks up the published report post by the trimmed event slug", () => {
    const post = { slug: "ai-meetup-report" };
    const posts = new Map([[post.slug, post]]);

    expect(
      reportPostForEvent(posts, { reportPostSlug: " ai-meetup-report " }),
    ).toBe(post);
    expect(
      reportPostForEvent(posts, { reportPostSlug: "missing-report" }),
    ).toBeNull();
  });
});
