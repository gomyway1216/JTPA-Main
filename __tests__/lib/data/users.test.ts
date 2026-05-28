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
    photoURL: "https://example.com/p.png",
    affiliation: "Test Corp",
    bio: "I do testing.",
    affiliationPublic: false,
    bioPublic: false,
    emailOptIn: true,
    createdAt: { seconds: 0, nanoseconds: 0 },
    updatedAt: { seconds: 0, nanoseconds: 0 },
    ...overrides,
  };
}

describe("projectPublicProfile (privacy boundary)", () => {
  it("always exposes uid + displayName + photoURL", () => {
    const out = projectPublicProfile(baseProfile());
    expect(out.uid).toBe("u1");
    expect(out.displayName).toBe("Test User");
    expect(out.photoURL).toBe("https://example.com/p.png");
  });

  it("NEVER leaks email, emailOptIn, or visibility flags themselves", () => {
    const out = projectPublicProfile(baseProfile());
    // Compile-time: PublicProfile doesn't declare these. Runtime check
    // belt-and-suspenders so a future code change can't silently broaden
    // the shape.
    expect(out).not.toHaveProperty("email");
    expect(out).not.toHaveProperty("emailOptIn");
    expect(out).not.toHaveProperty("affiliationPublic");
    expect(out).not.toHaveProperty("bioPublic");
    expect(out).not.toHaveProperty("createdAt");
    expect(out).not.toHaveProperty("updatedAt");
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

  it("treats missing visibility flags (older docs) as false", () => {
    // Cast through `unknown` because the fields are optional on the type
    // but we want the JS-level absence, not `undefined` explicitly. The
    // `?? false` defaulting in the projection should treat both the same.
    const stripped = baseProfile() as UserProfile;
    delete (stripped as { affiliationPublic?: boolean }).affiliationPublic;
    delete (stripped as { bioPublic?: boolean }).bioPublic;
    const out = projectPublicProfile(stripped);
    expect(out.affiliation).toBeNull();
    expect(out.bio).toBeNull();
  });

  it("returns null photoURL when stored value is missing", () => {
    const stripped = baseProfile();
    delete (stripped as { photoURL?: string }).photoURL;
    expect(projectPublicProfile(stripped).photoURL).toBeNull();
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
});
