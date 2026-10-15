import { describe, expect, it } from "vitest";

import {
  socialCardAlt,
  socialCardContentType,
  socialCardSize,
} from "@/lib/social-card";

describe("social card metadata", () => {
  it("uses the recommended social preview dimensions", () => {
    expect(socialCardSize).toEqual({ width: 1200, height: 630 });
  });

  it("describes the site and declares a PNG response", () => {
    expect(socialCardAlt).toContain("Bay Area AI Study Group");
    expect(socialCardAlt).toContain("Japanese AI Community");
    expect(socialCardContentType).toBe("image/png");
  });
});
