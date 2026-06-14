import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  classNames,
  formatDate,
  formatDateTime,
  formatTime,
  isEventEnded,
  slugify,
  stripMarkdown,
  toDate,
  truncate,
} from "@/lib/utils";

describe("toDate", () => {
  it("returns null for undefined and null", () => {
    expect(toDate(undefined)).toBeNull();
    expect(toDate(null)).toBeNull();
  });

  it("returns the same Date when passed a Date", () => {
    const d = new Date("2025-01-01T00:00:00Z");
    expect(toDate(d)).toBe(d);
  });

  it("converts ISO date strings", () => {
    const result = toDate("2025-01-01T00:00:00.000Z");
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe("2025-01-01T00:00:00.000Z");
  });

  it("invokes toDate() on Firestore client Timestamps", () => {
    const expected = new Date("2025-06-15T12:34:56Z");
    const stub = { toDate: () => expected } as unknown as Parameters<
      typeof toDate
    >[0];
    expect(toDate(stub)).toBe(expected);
  });

  it("converts {seconds, nanoseconds} shape", () => {
    const value = { seconds: 1_700_000_000, nanoseconds: 500_000_000 };
    const result = toDate(value);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(1_700_000_000 * 1000 + 500);
  });

  it("converts Admin-SDK {_seconds, _nanoseconds} shape", () => {
    const value = { _seconds: 1_700_000_000, _nanoseconds: 250_000_000 };
    const result = toDate(value);
    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(1_700_000_000 * 1000 + 250);
  });

  it("returns null for unknown object shapes", () => {
    const value = { foo: "bar" } as unknown as Parameters<typeof toDate>[0];
    expect(toDate(value)).toBeNull();
  });
});

describe("formatDate / formatDateTime / formatTime", () => {
  // vitest.config.mts pins TZ=Asia/Tokyo, so the ja-JP formatters in
  // src/lib/utils.ts produce deterministic JST clock values. 05:30 UTC →
  // 14:30 JST on 2025-03-15 (a Saturday).
  const d = new Date("2025-03-15T05:30:00Z");

  it("formatDate returns empty string for missing input", () => {
    expect(formatDate(undefined)).toBe("");
    expect(formatDate(null)).toBe("");
  });

  it("formatTime returns empty string for missing input", () => {
    expect(formatTime(undefined)).toBe("");
  });

  it("formatDateTime returns empty string for missing input", () => {
    expect(formatDateTime(null)).toBe("");
  });

  it("formatDate renders the JST y/m/d (+ weekday)", () => {
    const result = formatDate(d);
    expect(result).toContain("2025年3月15日");
    // weekday: "short" → "土" somewhere in the output
    expect(result).toContain("土");
  });

  it("formatTime renders HH:MM in JST", () => {
    expect(formatTime(d)).toBe("14:30");
  });

  it("formatDateTime joins the JST date and time with a space", () => {
    const result = formatDateTime(d);
    expect(result).toContain("2025年3月15日");
    expect(result.endsWith(" 14:30")).toBe(true);
  });
});

describe("slugify", () => {
  it("lowercases, trims, and replaces spaces with hyphens", () => {
    expect(slugify("  Hello World  ")).toBe("hello-world");
  });

  it("strips disallowed punctuation but keeps hyphens", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("foo - bar")).toBe("foo---bar");
  });

  it("caps the slug at 80 characters", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBe(80);
  });

  it("falls back to a prefixed base36 timestamp when input strips to empty", () => {
    const slug = slugify("こんにちは");
    expect(slug.startsWith("event-")).toBe(true);
    expect(slug.length).toBeGreaterThan("event-".length);
  });

  it("falls back when the cleaned slug is shorter than 2 chars", () => {
    const slug = slugify("a", "post");
    expect(slug.startsWith("post-")).toBe(true);
  });

  it("uses the provided fallback prefix", () => {
    const slug = slugify("！！！", "guide");
    expect(slug.startsWith("guide-")).toBe(true);
  });
});

describe("isEventEnded", () => {
  const FIXED_NOW = new Date("2025-06-01T00:00:00Z").getTime();

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("returns true when status is 'past'", () => {
    const future = new Date(FIXED_NOW + 86_400_000);
    expect(isEventEnded({ endAt: future, status: "past" })).toBe(true);
  });

  it("returns true when status is 'cancelled'", () => {
    const future = new Date(FIXED_NOW + 86_400_000);
    expect(isEventEnded({ endAt: future, status: "cancelled" })).toBe(true);
  });

  it("returns true when endAt is in the past, even if published", () => {
    const past = new Date(FIXED_NOW - 1000);
    expect(isEventEnded({ endAt: past, status: "published" })).toBe(true);
  });

  it("returns false when endAt is in the future and status is published", () => {
    const future = new Date(FIXED_NOW + 86_400_000);
    expect(isEventEnded({ endAt: future, status: "published" })).toBe(false);
  });

  it("returns false when endAt is unparseable and status is not terminal", () => {
    const garbage = { foo: "bar" } as unknown as Parameters<
      typeof isEventEnded
    >[0]["endAt"];
    expect(isEventEnded({ endAt: garbage, status: "published" })).toBe(false);
  });
});

describe("classNames", () => {
  it("joins truthy strings with a single space", () => {
    expect(classNames("a", "b", "c")).toBe("a b c");
  });

  it("filters out false / null / undefined", () => {
    expect(classNames("a", false, null, undefined, "b")).toBe("a b");
  });

  it("returns an empty string when nothing is truthy", () => {
    expect(classNames(false, null, undefined)).toBe("");
  });
});

describe("stripMarkdown", () => {
  it("removes fenced code blocks", () => {
    expect(stripMarkdown("hello\n```js\nconst x = 1;\n```\nworld")).toBe(
      "hello world",
    );
  });

  it("removes inline code", () => {
    expect(stripMarkdown("see `foo()` for details")).toBe("see for details");
  });

  it("strips image syntax entirely", () => {
    expect(stripMarkdown("before ![alt](http://x.png) after")).toBe(
      "before after",
    );
  });

  it("keeps link text but drops the URL", () => {
    expect(stripMarkdown("read [the docs](https://example.com) please")).toBe(
      "read the docs please",
    );
  });

  it("strips heading markers", () => {
    expect(stripMarkdown("# Title\n## Sub\nbody")).toBe("Title Sub body");
  });

  it("strips emphasis markers (* _ ~)", () => {
    expect(stripMarkdown("*bold* _em_ ~strike~")).toBe("bold em strike");
  });

  it("collapses whitespace and trims", () => {
    expect(stripMarkdown("  hello   world  ")).toBe("hello world");
  });
});

describe("truncate", () => {
  it("returns the input unchanged when within budget", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("prefers a word boundary when one is close enough to the end", () => {
    // "the quick brown fox" with max=15 → budget 14 → "the quick brow"
    // last space at index 9 (>= 14*0.6=8.4) → cut to "the quick" + "…"
    expect(truncate("the quick brown fox", 15)).toBe("the quick…");
  });

  it("falls back to a hard cut when no space is close to the end (CJK)", () => {
    // No spaces at all — cut should be a flat slice + ellipsis.
    const input = "あいうえおかきくけこさしすせそたちつてと"; // 20 chars
    const out = truncate(input, 10);
    expect(out.endsWith("…")).toBe(true);
    expect([...out].length).toBe(10);
  });

  it("never exceeds the max-character budget", () => {
    const input = "x".repeat(100);
    const out = truncate(input, 25);
    expect([...out].length).toBeLessThanOrEqual(25);
    expect(out.endsWith("…")).toBe(true);
  });

  // Boundary cases for tiny budgets. Without the `max <= 0` guard, max=0
  // would slice with budget=-1 (text.slice(0, -1)) and silently exceed
  // the cap. max=1 must fit only the ellipsis.
  it("returns empty string when max=0 (cannot fit even an ellipsis)", () => {
    expect(truncate("hello", 0)).toBe("");
  });

  it("returns just the ellipsis when max=1", () => {
    expect(truncate("hello", 1)).toBe("…");
  });

  it("handles negative max as 'no room for output'", () => {
    expect(truncate("hello", -3)).toBe("");
  });
});
