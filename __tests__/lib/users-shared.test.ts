import { describe, expect, it } from "vitest";

import {
  defaultUsernameFor,
  detectSnsPlatform,
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
