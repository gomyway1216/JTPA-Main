import { describe, expect, it } from "vitest";

import {
  isParentPubliclyVisible,
  parentCollection,
  parentRoutePrefix,
} from "@/lib/comments-parent";
import type { CommentParentType } from "@/lib/types";

const PARENT_TYPES: CommentParentType[] = [
  "post",
  "guide",
  "qa",
  "project",
  "poll",
];

describe("parentCollection", () => {
  it.each([
    ["post", "posts"],
    ["guide", "guides"],
    ["qa", "qa"],
    ["project", "projects"],
    ["poll", "polls"],
  ] as const)("maps %s → %s", (parent, expected) => {
    expect(parentCollection(parent)).toBe(expected);
  });

  it("covers every CommentParentType", () => {
    for (const t of PARENT_TYPES) {
      expect(typeof parentCollection(t)).toBe("string");
      expect(parentCollection(t).length).toBeGreaterThan(0);
    }
  });
});

describe("parentRoutePrefix", () => {
  it.each([
    ["post", "/blog"],
    ["guide", "/guide"],
    ["qa", "/qa"],
    ["project", "/showcase"],
    ["poll", "/poll"],
  ] as const)("maps %s → %s", (parent, expected) => {
    expect(parentRoutePrefix(parent)).toBe(expected);
  });

  it("always returns a leading-slash path", () => {
    for (const t of PARENT_TYPES) {
      expect(parentRoutePrefix(t).startsWith("/")).toBe(true);
    }
  });
});

describe("isParentPubliclyVisible", () => {
  // projects use a moderation queue (status "approved" === visible) while
  // posts/guides/qa use "published". Make sure the predicate enforces this
  // split — a stray "published" project or a stray "approved" post must
  // both come back false.
  it("treats projects as visible only when status === 'approved'", () => {
    expect(isParentPubliclyVisible("project", { status: "approved" })).toBe(
      true,
    );
    expect(isParentPubliclyVisible("project", { status: "published" })).toBe(
      false,
    );
    expect(isParentPubliclyVisible("project", { status: "pending" })).toBe(
      false,
    );
    expect(isParentPubliclyVisible("project", { status: "rejected" })).toBe(
      false,
    );
    expect(isParentPubliclyVisible("project", { status: "archived" })).toBe(
      false,
    );
  });

  it.each(["post", "guide", "qa", "poll"] as const)(
    "treats %s as visible only when status === 'published'",
    (type) => {
      expect(isParentPubliclyVisible(type, { status: "published" })).toBe(true);
      expect(isParentPubliclyVisible(type, { status: "approved" })).toBe(false);
      expect(isParentPubliclyVisible(type, { status: "draft" })).toBe(false);
      expect(isParentPubliclyVisible(type, { status: "archived" })).toBe(false);
      expect(isParentPubliclyVisible(type, { status: "" })).toBe(false);
    },
  );
});
