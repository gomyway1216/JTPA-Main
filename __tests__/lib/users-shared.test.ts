import { describe, expect, it } from "vitest";

import {
  defaultUsernameFor,
  detectSnsPlatform,
  isCanonicalAvatarUrl,
  isOwnedAvatarPath,
  isReservedUsername,
  normalizeUsername,
  USERNAME_REGEX,
  validateUsernameFormat,
} from "@/lib/users-shared";

describe("USERNAME_REGEX", () => {
  // Spot-check the happy cases so a future tightening can't silently
  // start rejecting handles the help text promises are allowed.
  it.each([
    "abc",
    "abc-def",
    "abc_def",
    "12345",
    "ab-c-d",
    "a-1-b-2",
    "user-fqe7jw", // matches the deterministic fallback shape
    "a".repeat(20),
  ])("accepts %s", (handle) => {
    expect(USERNAME_REGEX.test(handle)).toBe(true);
  });

  // Per PR #79 Copilot review — the old pattern accepted these despite
  // the doc comment claiming they were rejected. The negative
  // lookahead in the current pattern locks them out.
  it.each([
    "foo__bar",
    "foo--bar",
    "foo_-bar",
    "foo-_bar",
    "ab___cd",
  ])("rejects consecutive separator: %s", (handle) => {
    expect(USERNAME_REGEX.test(handle)).toBe(false);
  });

  it.each([
    "ab", // too short
    "a".repeat(21), // too long
    "Abc", // uppercase
    "abc!", // special char
    "abc def", // space
    "_abc", // leading separator
    "abc-", // trailing separator
    "-abc", // leading separator
    "abc_", // trailing separator
    "", // empty
  ])("rejects %s", (handle) => {
    expect(USERNAME_REGEX.test(handle)).toBe(false);
  });
});

describe("validateUsernameFormat", () => {
  it("returns null for a clean handle", () => {
    expect(validateUsernameFormat("yudai")).toBeNull();
  });
  it("normalizes case + whitespace before testing", () => {
    expect(validateUsernameFormat("  YUDAI  ")).toBeNull();
  });
  it("reports empty input distinctly from a format error", () => {
    expect(validateUsernameFormat("")).toBe("empty");
    expect(validateUsernameFormat("   ")).toBe("empty");
  });
  it("reports format errors for shape violations", () => {
    expect(validateUsernameFormat("ab")).toBe("format");
    expect(validateUsernameFormat("foo__bar")).toBe("format");
  });
  it("reports reserved error for blocked top-level routes", () => {
    expect(validateUsernameFormat("admin")).toBe("reserved");
    expect(validateUsernameFormat("login")).toBe("reserved");
  });
  it("reports reserved error for the system `user-` prefix", () => {
    // `defaultUsernameFor` emits `user-<6chars>` for every account
    // that hasn't claimed an explicit handle. Allowing manual claims
    // in that namespace would let a user grab another user's
    // auto-default — see Yudai's bug where `user-2ex7b4` (someone
    // else's default) was reported as available.
    expect(validateUsernameFormat("user-2ex7b4")).toBe("reserved");
    expect(validateUsernameFormat("user-anything-else")).toBe("reserved");
    expect(validateUsernameFormat("user-")).toBe("format"); // trailing `-` fails regex first; covered for completeness
  });
  it("still allows handles that merely contain 'user'", () => {
    // The prefix is `user-` specifically, not `user` — handles like
    // `superuser`, `user1`, `useragent` are NOT in the auto-default
    // namespace and should pass.
    expect(validateUsernameFormat("superuser")).toBeNull();
    expect(validateUsernameFormat("user1")).toBeNull();
    expect(validateUsernameFormat("useragent")).toBeNull();
  });
});

describe("isReservedUsername (centralized helper)", () => {
  it("returns true for exact-name reservations", () => {
    expect(isReservedUsername("admin")).toBe(true);
    expect(isReservedUsername("login")).toBe(true);
  });
  it("returns true for prefix reservations", () => {
    expect(isReservedUsername("user-abc123")).toBe(true);
    expect(isReservedUsername("user-")).toBe(true); // the prefix itself
  });
  it("returns false for clean handles", () => {
    expect(isReservedUsername("yudai")).toBe(false);
    expect(isReservedUsername("useragent")).toBe(false);
    expect(isReservedUsername("user1")).toBe(false);
  });
  it("expects pre-normalized input — caller normalizes", () => {
    // Helper does not lowercase / trim; the format validator does
    // that work upstream. This test pins the contract so a future
    // caller that forgets to normalize fails loudly.
    expect(isReservedUsername("USER-ABC")).toBe(false); // not lowercased
    expect(isReservedUsername("  admin  ")).toBe(false); // not trimmed
  });
});

describe("normalizeUsername", () => {
  it("lowercases and trims", () => {
    expect(normalizeUsername("  Yudai-1  ")).toBe("yudai-1");
  });
});

describe("defaultUsernameFor", () => {
  it("returns user-<6chars-lowercased>", () => {
    expect(defaultUsernameFor("ABCdef123456")).toBe("user-abcdef");
  });
  it("output always passes USERNAME_REGEX (deterministic fallback must be a valid handle)", () => {
    // Random-ish uid samples — the fallback must never produce a
    // handle that would itself fail validation, or the read-side
    // projection would emit an invalid username.
    for (const uid of [
      "FQe7JWGETbTm9w9sAZgacemC1aC3",
      "0123456789abcdef",
      "aaaaaaa",
      "ZZZZZZ",
    ]) {
      expect(USERNAME_REGEX.test(defaultUsernameFor(uid))).toBe(true);
    }
  });
});

describe("detectSnsPlatform", () => {
  it.each([
    ["https://x.com/foo", "x"],
    ["https://twitter.com/foo", "x"],
    ["https://www.x.com/foo", "x"],
    ["https://instagram.com/foo", "instagram"],
    ["https://threads.net/@foo", "threads"],
    ["https://bsky.app/profile/foo", "bluesky"],
    ["https://mastodon.social/@foo", "mastodon"],
    ["https://www.tiktok.com/@foo", "tiktok"],
    ["https://facebook.com/foo", "facebook"],
    ["https://youtu.be/abc", "youtube"],
  ])("maps %s → %s", (url, platform) => {
    expect(detectSnsPlatform(url)).toBe(platform);
  });

  it("falls back to generic for unknown hosts and for un-parseable inputs", () => {
    expect(detectSnsPlatform("https://example.com/foo")).toBe("generic");
    expect(detectSnsPlatform("not a url")).toBe("generic");
    expect(detectSnsPlatform("")).toBe("generic");
  });
});

describe("isOwnedAvatarPath", () => {
  it("accepts a flat avatar object directly under the user's folder", () => {
    expect(isOwnedAvatarPath("u1", "users/u1/avatar-123-me.png")).toBe(true);
  });

  it("rejects another user's folder", () => {
    expect(isOwnedAvatarPath("u1", "users/u2/avatar-123-me.png")).toBe(false);
  });

  it("rejects a path outside users/{uid}/", () => {
    expect(isOwnedAvatarPath("u1", "posts/u1/x.png")).toBe(false);
    // The folder itself (no object) and a bare prefix are not valid objects.
    expect(isOwnedAvatarPath("u1", "users/u1")).toBe(false);
    expect(isOwnedAvatarPath("u1", "users/u1/")).toBe(false);
  });

  it("rejects nesting and traversal under the user's folder", () => {
    expect(isOwnedAvatarPath("u1", "users/u1/sub/x.png")).toBe(false);
    expect(isOwnedAvatarPath("u1", "users/u1/../u2/x.png")).toBe(false);
    expect(isOwnedAvatarPath("u1", "users/u1/..%2Fevil")).toBe(false);
  });
});

describe("isCanonicalAvatarUrl", () => {
  const bucket = "demo-bucket";
  const path = "users/u1/avatar-123-me.png";
  const enc = encodeURIComponent(path);

  it("accepts the canonical production download URL for the path", () => {
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${enc}?alt=media`;
    expect(isCanonicalAvatarUrl(url, bucket, path)).toBe(true);
  });

  it("accepts the local emulator host (any port)", () => {
    const url = `http://127.0.0.1:9199/v0/b/${bucket}/o/${enc}?alt=media`;
    expect(isCanonicalAvatarUrl(url, bucket, path)).toBe(true);
  });

  it("rejects an arbitrary host even when it embeds the encoded path", () => {
    // The exact attack from the PR #96 review: the encoded path smuggled
    // into a foreign host's URL must NOT pass.
    const url = `https://evil.example.com/v0/b/${bucket}/o/${enc}?alt=media`;
    expect(isCanonicalAvatarUrl(url, bucket, path)).toBe(false);
  });

  it("rejects a URL for a different bucket", () => {
    const url = `https://firebasestorage.googleapis.com/v0/b/other-bucket/o/${enc}?alt=media`;
    expect(isCanonicalAvatarUrl(url, bucket, path)).toBe(false);
  });

  it("rejects a URL whose object path doesn't match", () => {
    const otherEnc = encodeURIComponent("users/u1/avatar-999-other.png");
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${otherEnc}?alt=media`;
    expect(isCanonicalAvatarUrl(url, bucket, path)).toBe(false);
  });

  it("rejects when alt=media is missing", () => {
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${enc}`;
    expect(isCanonicalAvatarUrl(url, bucket, path)).toBe(false);
  });

  it("rejects an un-parseable URL", () => {
    expect(isCanonicalAvatarUrl("not a url", bucket, path)).toBe(false);
  });
});
