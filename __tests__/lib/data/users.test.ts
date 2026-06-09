import { describe, expect, it } from "vitest";

import { projectPublicProfile } from "@/lib/data/users";
import type { UserProfile } from "@/lib/types";

// Minimal stored UserProfile with every flag off — used as the base for
// per-test mutations.
function baseProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: "u1",
    email: "secret@example.com",
    displayName: "Test User",
    username: "testuser",
    photoURL: "https://example.com/p.png",
    affiliation: "Test Corp",
    bio: "I do testing.",
    affiliationPublic: false,
    bioPublic: false,
    fullNamePublic: false,
    emailOptIn: true,
    links: {},
    eventAttendanceCount: 3,
    createdAt: { seconds: 0, nanoseconds: 0 },
    updatedAt: { seconds: 0, nanoseconds: 0 },
    ...overrides,
  };
}

describe("projectPublicProfile (privacy boundary)", () => {
  it("always exposes uid + username + photoURL", () => {
    const out = projectPublicProfile(baseProfile());
    expect(out.uid).toBe("u1");
    expect(out.username).toBe("testuser");
    expect(out.photoURL).toBe("https://example.com/p.png");
    expect(out.eventAttendanceCount).toBe(3);
  });

  it("NEVER leaks email, emailOptIn, displayName (when private), or visibility flags themselves", () => {
    const out = projectPublicProfile(baseProfile());
    // Compile-time: PublicProfile doesn't declare these. Runtime check
    // belt-and-suspenders so a future code change can't silently broaden
    // the shape.
    expect(out).not.toHaveProperty("email");
    expect(out).not.toHaveProperty("emailOptIn");
    expect(out).not.toHaveProperty("affiliationPublic");
    expect(out).not.toHaveProperty("bioPublic");
    expect(out).not.toHaveProperty("fullNamePublic");
    expect(out).not.toHaveProperty("createdAt");
    expect(out).not.toHaveProperty("updatedAt");
    // Real name is null when fullNamePublic is false — not the raw
    // displayName string. The /u/[uid] page reads `fullName`, not a
    // separate displayName field, so this is the visible guarantee.
    expect(out.fullName).toBeNull();
  });

  it("defaults malformed or missing attendance counts to 0", () => {
    const missing = baseProfile();
    delete (missing as { eventAttendanceCount?: number }).eventAttendanceCount;
    expect(projectPublicProfile(missing).eventAttendanceCount).toBe(0);

    const malformed = baseProfile();
    (malformed as { eventAttendanceCount?: unknown }).eventAttendanceCount = -2;
    expect(projectPublicProfile(malformed).eventAttendanceCount).toBe(0);
  });

  it("truncates fractional attendance counts defensively", () => {
    expect(
      projectPublicProfile(baseProfile({ eventAttendanceCount: 4.8 }))
        .eventAttendanceCount,
    ).toBe(4);
  });

  it("hides affiliation when affiliationPublic = false", () => {
    expect(projectPublicProfile(baseProfile()).affiliation).toBeNull();
  });

  it("exposes affiliation when affiliationPublic = true", () => {
    const out = projectPublicProfile(
      baseProfile({ affiliationPublic: true }),
    );
    expect(out.affiliation).toBe("Test Corp");
  });

  it("hides bio when bioPublic = false", () => {
    expect(projectPublicProfile(baseProfile()).bio).toBeNull();
  });

  it("exposes bio when bioPublic = true", () => {
    const out = projectPublicProfile(baseProfile({ bioPublic: true }));
    expect(out.bio).toBe("I do testing.");
  });

  it("exposes fullName only when fullNamePublic = true", () => {
    expect(projectPublicProfile(baseProfile()).fullName).toBeNull();
    const opted = projectPublicProfile(
      baseProfile({ fullNamePublic: true }),
    );
    expect(opted.fullName).toBe("Test User");
  });

  it("treats missing visibility flags (older docs) as false", () => {
    // Simulate a doc that pre-dates the visibility-flag fields: the
    // properties are absent (not just `false`). The projection uses a
    // truthy check (`data.affiliationPublic ? ... : null`), so absent
    // and `false` collapse to the same private-by-default behavior —
    // per PR #59 Copilot review (comment was previously misleading
    // about a `?? false` defaulting that the code doesn't actually do).
    const stripped = baseProfile();
    delete (stripped as { affiliationPublic?: boolean }).affiliationPublic;
    delete (stripped as { bioPublic?: boolean }).bioPublic;
    delete (stripped as { fullNamePublic?: boolean }).fullNamePublic;
    const out = projectPublicProfile(stripped);
    expect(out.affiliation).toBeNull();
    expect(out.bio).toBeNull();
    expect(out.fullName).toBeNull();
  });

  it("returns null photoURL when stored value is missing", () => {
    const stripped = baseProfile();
    delete (stripped as { photoURL?: string }).photoURL;
    expect(projectPublicProfile(stripped).photoURL).toBeNull();
  });

  it("prefers the uploaded avatar over the Google photoURL", () => {
    // A user who uploaded a custom icon should see it everywhere the
    // public projection feeds (/u/[uid], author badges), regardless of
    // what Google still has on file.
    const out = projectPublicProfile(
      baseProfile({
        avatar: {
          path: "users/u1/avatar-1-me.png",
          url: "https://cdn.example.com/me.png",
        },
      }),
    );
    expect(out.photoURL).toBe("https://cdn.example.com/me.png");
  });

  it("uses the uploaded avatar even when the Google photoURL is absent", () => {
    const stripped = baseProfile({
      avatar: {
        path: "users/u1/avatar-1-me.png",
        url: "https://cdn.example.com/me.png",
      },
    });
    delete (stripped as { photoURL?: string }).photoURL;
    expect(projectPublicProfile(stripped).photoURL).toBe(
      "https://cdn.example.com/me.png",
    );
  });

  it("treats absent affiliation/bio as empty string when published", () => {
    // A user could publish without typing anything — render as "" not
    // null so the consumer doesn't render a misleading "private" label.
    const partial = baseProfile({
      affiliationPublic: true,
      bioPublic: true,
    });
    delete (partial as { affiliation?: string }).affiliation;
    delete (partial as { bio?: string }).bio;
    const out = projectPublicProfile(partial);
    expect(out.affiliation).toBe("");
    expect(out.bio).toBe("");
  });

  it("falls back to a deterministic username when the stored value is missing", () => {
    // Docs that pre-date the `username` field land here without one.
    // The projection backfills `user-<first6chars>` so every render
    // path always has a non-empty handle to show.
    const stripped = baseProfile({ uid: "abcdef123456" });
    delete (stripped as { username?: string }).username;
    expect(projectPublicProfile(stripped).username).toBe("user-abcdef");
  });

  it("forwards the denormalized roleBadge as role on the public profile", () => {
    expect(projectPublicProfile(baseProfile({ roleBadge: "admin" })).role).toBe(
      "admin",
    );
    expect(
      projectPublicProfile(baseProfile({ roleBadge: "editor" })).role,
    ).toBe("editor");
    expect(
      projectPublicProfile(baseProfile({ roleBadge: "contributor" })).role,
    ).toBe("contributor");
  });

  it("returns null role when roleBadge is absent (plain user)", () => {
    expect(projectPublicProfile(baseProfile()).role).toBeNull();
  });

  it("rejects unknown roleBadge values so a bad write can't leak a custom string", () => {
    // The Firestore doc isn't schema-validated client-side — a stale doc
    // with a typo'd badge value mustn't slip through and render an
    // unexpected pill. The projection defensively allowlists the three
    // canonical claims.
    const partial = baseProfile();
    (partial as { roleBadge?: string }).roleBadge = "superadmin";
    expect(projectPublicProfile(partial).role).toBeNull();
  });

  it("strips empty link slots so the icon row only renders inhabited entries", () => {
    const out = projectPublicProfile(
      baseProfile({
        links: {
          portfolio: "https://example.com",
          github: "",
          linkedin: undefined,
          sns: "https://x.com/foo",
        },
      }),
    );
    expect(out.links).toEqual({
      portfolio: "https://example.com",
      sns: "https://x.com/foo",
    });
  });
});
