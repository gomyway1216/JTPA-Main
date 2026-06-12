import { describe, expect, it } from "vitest";

import { canViewProjectDetail } from "@/lib/projects-visibility";
import type { ProjectStatus } from "@/lib/types";

function project(status: ProjectStatus) {
  return { ownerUid: "owner-1", status };
}

describe("canViewProjectDetail", () => {
  it("allows everyone to view approved projects", () => {
    expect(canViewProjectDetail(project("approved"), null)).toBe(true);
    expect(
      canViewProjectDetail(project("approved"), {
        uid: "viewer-1",
        isAdmin: false,
      }),
    ).toBe(true);
  });

  it("allows admins to preview non-public projects", () => {
    for (const status of ["pending", "rejected", "archived"] as const) {
      expect(
        canViewProjectDetail(project(status), {
          uid: "admin-1",
          isAdmin: true,
        }),
      ).toBe(true);
    }
  });

  it("allows the owner to preview their own non-public projects", () => {
    expect(
      canViewProjectDetail(project("pending"), {
        uid: "owner-1",
        isAdmin: false,
      }),
    ).toBe(true);
  });

  it("hides non-public projects from anonymous and unrelated users", () => {
    expect(canViewProjectDetail(project("pending"), null)).toBe(false);
    expect(
      canViewProjectDetail(project("pending"), {
        uid: "viewer-1",
        isAdmin: false,
      }),
    ).toBe(false);
  });
});
