import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { PublicProfile } from "@/lib/data/users";
import {
  MAINTAINER_LINKS,
  MAINTAINER_NAME,
  MAINTAINER_PROFILE_PATH,
  MAINTAINER_UID,
} from "@/lib/maintainer";
import {
  authorPersonJsonLd,
  maintainerPersonId,
  profilePageJsonLd,
  siteIdentityJsonLd,
} from "@/lib/seo";

const ORIGINAL_ENV = process.env;

function profile(overrides: Partial<PublicProfile> = {}): PublicProfile {
  return {
    uid: "user-1",
    username: "alice",
    fullName: "Alice Example",
    photoURL: "https://cdn.example.com/alice.png",
    affiliation: null,
    bio: "Builds community tools.",
    links: {},
    role: null,
    eventAttendanceCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, SITE_URL: "https://example.test" };
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("siteIdentityJsonLd", () => {
  it("connects the website to Yudai Yaguchi as creator and maintainer", () => {
    const jsonLd = siteIdentityJsonLd({
      locale: "ja",
      title: "ベイエリアAI勉強会 | JTPA",
      description: "AI community",
    });
    const graph = jsonLd["@graph"] as Record<string, unknown>[];
    const website = graph.find((item) => item["@type"] === "WebSite");
    const person = graph.find((item) => item["@type"] === "Person");

    expect(website).toMatchObject({
      creator: { "@id": "https://example.test/ja/u/yudai-yaguchi#person" },
      maintainer: { "@id": "https://example.test/ja/u/yudai-yaguchi#person" },
    });
    expect(person).toMatchObject({
      "@id": "https://example.test/ja/u/yudai-yaguchi#person",
      name: MAINTAINER_NAME,
      sameAs: expect.arrayContaining([MAINTAINER_LINKS.linkedin]),
    });
  });
});

describe("profilePageJsonLd", () => {
  it("uses the canonical maintainer URL and LinkedIn sameAs on Yudai's profile", () => {
    const jsonLd = profilePageJsonLd({
      locale: "en",
      profile: profile({ uid: MAINTAINER_UID, username: "yudai" }),
      links: MAINTAINER_LINKS,
      description: "Creator and maintainer.",
      contributionCount: 3,
      isMaintainer: true,
    });
    const mainEntity = jsonLd.mainEntity as Record<string, unknown>;

    expect(jsonLd).toMatchObject({
      "@type": "ProfilePage",
      url: "https://example.test/en/u/yudai-yaguchi",
    });
    expect(mainEntity).toMatchObject({
      "@id": maintainerPersonId(),
      name: MAINTAINER_NAME,
      sameAs: expect.arrayContaining([MAINTAINER_LINKS.linkedin]),
      agentInteractionStatistic: {
        userInteractionCount: 3,
      },
    });
  });
});

describe("authorPersonJsonLd", () => {
  it("links maintainer-authored content to the canonical profile", () => {
    expect(
      authorPersonJsonLd({
        uid: MAINTAINER_UID,
        locale: "ja",
        fallbackName: "Yudai",
      }),
    ).toMatchObject({
      "@id": "https://example.test/ja/u/yudai-yaguchi#person",
      name: MAINTAINER_NAME,
      url: "https://example.test/ja/u/yudai-yaguchi",
      sameAs: expect.arrayContaining([MAINTAINER_LINKS.linkedin]),
    });
  });

  it("keeps regular authors on their uid profile URL", () => {
    expect(
      authorPersonJsonLd({
        uid: "user-1",
        locale: "en",
        fallbackName: "Alice Example",
        profile: profile(),
      }),
    ).toMatchObject({
      name: "Alice Example",
      url: "https://example.test/en/u/user-1",
    });
  });

  it("exports the expected canonical maintainer path", () => {
    expect(MAINTAINER_PROFILE_PATH).toBe("/u/yudai-yaguchi");
  });
});
