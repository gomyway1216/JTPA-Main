import { describe, expect, it } from "vitest";

import { validateSurveyFields } from "@/lib/event-survey";
import type { SurveyField } from "@/lib/types";

function field(partial: Partial<SurveyField>): SurveyField {
  return {
    key: "q1",
    label: "ラベル",
    type: "text",
    required: false,
    audience: "all",
    ...partial,
  };
}

describe("validateSurveyFields", () => {
  it("returns null for an empty list (no questionnaire)", () => {
    expect(validateSurveyFields([])).toBeNull();
  });

  it("returns null when every field is well-formed", () => {
    expect(
      validateSurveyFields([
        field({ key: "q1", label: "お名前" }),
        field({
          key: "q2",
          label: "参加形態",
          type: "select",
          options: ["現地", "オンライン"],
        }),
      ]),
    ).toBeNull();
  });

  it("rejects an empty or whitespace-only label (the issue #102 trigger)", () => {
    // The form seeds a freshly-added field with label: "" — this is the
    // exact payload that crashed the save.
    expect(validateSurveyFields([field({ label: "" })])).toMatch(
      /表示ラベル/,
    );
    expect(validateSurveyFields([field({ label: "   " })])).toMatch(
      /表示ラベル/,
    );
  });

  it("rejects an empty or whitespace-only key", () => {
    expect(validateSurveyFields([field({ key: "" })])).toMatch(/key/);
    expect(validateSurveyFields([field({ key: "  " })])).toMatch(/key/);
  });

  it("rejects a select with no usable options", () => {
    expect(
      validateSurveyFields([field({ type: "select", options: undefined })]),
    ).toMatch(/選択肢/);
    expect(
      validateSurveyFields([field({ type: "select", options: [] })]),
    ).toMatch(/選択肢/);
    expect(
      validateSurveyFields([field({ type: "select", options: ["  "] })]),
    ).toMatch(/選択肢/);
  });

  it("accepts a non-select field even without options", () => {
    expect(
      validateSurveyFields([field({ type: "checkbox", options: undefined })]),
    ).toBeNull();
  });

  it("reports the first offending item with its 1-based number", () => {
    const msg = validateSurveyFields([
      field({ key: "q1", label: "ok" }),
      field({ key: "q2", label: "" }),
    ]);
    expect(msg).toContain("アンケート項目2");
  });
});
