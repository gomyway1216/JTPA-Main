import { describe, expect, it } from "vitest";

import {
  isProjectAsset,
  projectAssetPathSet,
  validProjectAssets,
} from "@/lib/assets";
import type { ProjectAsset } from "@/lib/types";

describe("asset helpers", () => {
  it("accepts only assets with both path and url", () => {
    expect(
      isProjectAsset({ path: "events/a.png", url: "https://x/a.png" }),
    ).toBe(true);
    expect(isProjectAsset({ path: "events/a.png" })).toBe(false);
    expect(isProjectAsset({ url: "https://x/a.png" })).toBe(false);
    expect(isProjectAsset(undefined)).toBe(false);
  });

  it("filters malformed asset arrays", () => {
    const valid = { path: "events/a.png", url: "https://x/a.png" };
    const malformed = [
      valid,
      { path: "events/missing-url.png" },
      { url: "https://x/missing-path.png" },
    ] as ProjectAsset[];

    expect(validProjectAssets(malformed)).toEqual([valid]);
  });

  it("collects existing paths for saved asset tracking", () => {
    expect(
      projectAssetPathSet([
        { path: "events/a.png", url: "https://x/a.png" },
        { path: "events/path-only.png" },
        undefined,
      ]),
    ).toEqual(new Set(["events/a.png", "events/path-only.png"]));
  });
});
