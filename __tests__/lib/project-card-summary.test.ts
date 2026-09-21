import { describe, expect, it } from "vitest";

import { projectCardSummary } from "@/lib/project-card-summary";

describe("projectCardSummary", () => {
  it("turns short Markdown into plain copy without adding an ellipsis", () => {
    expect(projectCardSummary("# A **useful** [project](https://example.com)\n\nTry it."))
      .toBe("A useful project Try it.");
  });

  it("does not include the full project body in a long excerpt", () => {
    const summary = projectCardSummary("Useful experiments. ".repeat(100) + "PRIVATE_TAIL");
    expect(summary.length).toBeLessThanOrEqual(160);
    expect(summary).toMatch(/^Useful experiments\./);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toContain("PRIVATE_TAIL");
  });

  it("limits Japanese text without spaces", () => {
    expect(projectCardSummary("日本語で学ぶ人工知能", 6)).toBe("日本語で学…");
  });

  it("keeps emoji sequences and combining characters intact", () => {
    expect(projectCardSummary("👩🏽‍💻か\u3099日本語", 3)).toBe("👩🏽‍💻か\u3099…");
  });

  it("handles empty and tiny budgets", () => {
    expect(projectCardSummary("", 160)).toBe("");
    expect(projectCardSummary("Hello", 0)).toBe("");
    expect(projectCardSummary("Hello", 1)).toBe("…");
    expect(projectCardSummary("Hello", 5)).toBe("Hello");
  });
});
