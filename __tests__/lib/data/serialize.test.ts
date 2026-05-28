import { describe, expect, it } from "vitest";

import { plainify } from "@/lib/data/serialize";

describe("plainify", () => {
  it("returns a deep-cloned copy (mutation of input does not leak)", () => {
    const input = { a: 1, nested: { b: 2 } };
    const out = plainify(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(out.nested).not.toBe(input.nested);

    input.nested.b = 999;
    expect(out.nested.b).toBe(2);
  });

  it("drops functions and undefined values (JSON semantics)", () => {
    const input = {
      keep: "yes",
      fn: () => 42,
      gone: undefined,
    } as unknown as Record<string, unknown>;
    const out = plainify(input) as Record<string, unknown>;
    expect(out.keep).toBe("yes");
    expect(out.fn).toBeUndefined();
    expect("gone" in out).toBe(false);
  });

  it("invokes toJSON on class instances (mimics admin Timestamp transport)", () => {
    class FakeTimestamp {
      constructor(
        public _seconds: number,
        public _nanoseconds: number,
      ) {}
      toJSON() {
        return {
          _seconds: this._seconds,
          _nanoseconds: this._nanoseconds,
        };
      }
    }
    const ts = new FakeTimestamp(1_700_000_000, 0);
    const out = plainify({ createdAt: ts }) as {
      createdAt: { _seconds: number; _nanoseconds: number };
    };
    expect(out.createdAt).toEqual({
      _seconds: 1_700_000_000,
      _nanoseconds: 0,
    });
    expect(out.createdAt).not.toBeInstanceOf(FakeTimestamp);
  });

  it("round-trips primitives unchanged", () => {
    expect(plainify(42)).toBe(42);
    expect(plainify("hello")).toBe("hello");
    expect(plainify(null)).toBeNull();
    expect(plainify(true)).toBe(true);
  });

  it("preserves arrays as arrays", () => {
    const arr = [1, "two", { three: 3 }];
    const out = plainify(arr);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toEqual(arr);
  });
});
