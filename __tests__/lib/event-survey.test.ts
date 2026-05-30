import { describe, expect, it } from "vitest";

import { validateSurveyFields } from "@/lib/event-survey";
import type { SurveyField } from "@/lib/types";

const messages = {
  missingKey: (index: number) =>
    `アンケート項目${index}: key（英数字）を入力してください`,
  duplicateKey: (index: number, key: string) =>
    `アンケート項目${index}: key「${key}」が重複しています。別の key を指定してください`,
  missingLabel: (index: number) =>
    `アンケート項目${index}: 表示ラベルを入力してください`,
  missingOption: (index: number) =>
    `アンケート項目${index}: 選択肢を1つ以上入力してください`,
};

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
    expect(validateSurveyFields([], messages)).toBeNull();
  });

  it("returns null when every field is well-formed", () => {
    expect(
      validateSurveyFields(
        [
          field({ key: "q1", label: "お名前" }),
          field({
            key: "q2",
            label: "参加形態",
            type: "select",
            options: ["現地", "オンライン"],
          }),
        ],
        messages,
      ),
    ).toBeNull();
  });

  it("rejects an empty or whitespace-only label (the issue #102 trigger)", () => {
    // The form seeds a freshly-added field with label: "" — this is the
    // exact payload that crashed the save.
    expect(validateSurveyFields([field({ label: "" })], messages)).toMatch(
      /表示ラベル/,
    );
    expect(validateSurveyFields([field({ label: "   " })], messages)).toMatch(
      /表示ラベル/,
    );
  });

  it("rejects an empty or whitespace-only key", () => {
    expect(validateSurveyFields([field({ key: "" })], messages)).toMatch(/key/);
    expect(validateSurveyFields([field({ key: "  " })], messages)).toMatch(
      /key/,
    );
  });

  it("rejects a select with no usable options", () => {
    expect(
      validateSurveyFields(
        [field({ type: "select", options: undefined })],
        messages,
      ),
    ).toMatch(/選択肢/);
    expect(
      validateSurveyFields([field({ type: "select", options: [] })], messages),
    ).toMatch(/選択肢/);
    expect(
      validateSurveyFields(
        [field({ type: "select", options: ["  "] })],
        messages,
      ),
    ).toMatch(/選択肢/);
  });

  it("accepts a non-select field even without options", () => {
    expect(
      validateSurveyFields(
        [field({ type: "checkbox", options: undefined })],
        messages,
      ),
    ).toBeNull();
  });

  it("reports the first offending item with its 1-based number", () => {
    const msg = validateSurveyFields(
      [
        field({ key: "q1", label: "ok" }),
        field({ key: "q2", label: "" }),
      ],
      messages,
    );
    expect(msg).toContain("アンケート項目2");
  });

  it("rejects duplicate keys (responses are keyed by `key`, so a dup loses data)", () => {
    // The form's `q${len+1}` seeding can repeat a key after a middle item
    // is deleted — that must not silently overwrite another field's answer.
    const msg = validateSurveyFields(
      [
        field({ key: "q1", label: "名前" }),
        field({ key: "q1", label: "所属" }),
      ],
      messages,
    );
    expect(msg).toContain("アンケート項目2");
    expect(msg).toContain("重複");
  });
});
