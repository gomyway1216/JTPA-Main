import { describe, expect, it } from "vitest";

import {
  MAX_SURVEY_ANSWER_LENGTH,
  validateSurveyFields,
  validateSurveyResponses,
} from "@/lib/event-survey";
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

describe("validateSurveyResponses", () => {
  it("accepts an empty submission when there are no fields", () => {
    expect(validateSurveyResponses([], {}, "attendee")).toBeNull();
  });

  it("accepts a well-formed submission for every field type", () => {
    const fields = [
      field({ key: "name", label: "Name", type: "text", required: true }),
      field({
        key: "mode",
        label: "Mode",
        type: "select",
        required: true,
        options: ["online", "offline"],
      }),
      field({ key: "agree", label: "Agree", type: "checkbox", required: true }),
      field({ key: "note", label: "Note", type: "textarea" }),
    ];
    const ok = validateSurveyResponses(
      fields,
      { name: "Alice", mode: "online", agree: "true", note: "" },
      "attendee",
    );
    expect(ok).toBeNull();
  });

  it("flags a missing required answer with its field key", () => {
    const fields = [field({ key: "name", label: "Name", required: true })];
    expect(validateSurveyResponses(fields, {}, "attendee")).toEqual({
      code: "required",
      key: "name",
    });
    // Whitespace-only is still "blank".
    expect(
      validateSurveyResponses(fields, { name: "   " }, "attendee"),
    ).toEqual({ code: "required", key: "name" });
  });

  it("requires a checkbox to be \"true\" when the field is required", () => {
    const fields = [
      field({ key: "agree", label: "Agree", type: "checkbox", required: true }),
    ];
    expect(
      validateSurveyResponses(fields, { agree: "false" }, "attendee"),
    ).toEqual({ code: "required", key: "agree" });
    expect(
      validateSurveyResponses(fields, { agree: "true" }, "attendee"),
    ).toBeNull();
  });

  it("rejects a checkbox value other than true/false", () => {
    const fields = [field({ key: "agree", type: "checkbox" })];
    expect(
      validateSurveyResponses(fields, { agree: "maybe" }, "attendee"),
    ).toEqual({ code: "checkbox", key: "agree" });
  });

  it("rejects a select answer outside the allowed options", () => {
    const fields = [
      field({
        key: "mode",
        type: "select",
        required: true,
        options: ["online", "offline"],
      }),
    ];
    expect(
      validateSurveyResponses(fields, { mode: "hybrid" }, "attendee"),
    ).toEqual({ code: "option", key: "mode" });
    expect(
      validateSurveyResponses(fields, { mode: "online" }, "attendee"),
    ).toBeNull();
  });

  it("allows an optional select left blank", () => {
    const fields = [
      field({ key: "mode", type: "select", options: ["a", "b"] }),
    ];
    expect(validateSurveyResponses(fields, { mode: "" }, "attendee")).toBeNull();
    expect(validateSurveyResponses(fields, {}, "attendee")).toBeNull();
  });

  it("rejects an answer longer than the cap", () => {
    const fields = [field({ key: "bio", type: "textarea" })];
    const tooLong = "x".repeat(MAX_SURVEY_ANSWER_LENGTH + 1);
    expect(
      validateSurveyResponses(fields, { bio: tooLong }, "attendee"),
    ).toEqual({ code: "tooLong", key: "bio" });
  });

  it("rejects a response key with no matching field", () => {
    const fields = [field({ key: "q1", label: "Q1" })];
    expect(
      validateSurveyResponses(fields, { q1: "ok", q2: "stray" }, "attendee"),
    ).toEqual({ code: "unknownKey", key: "q2" });
  });

  it("treats presenter-audience fields as applicable only for a presenter", () => {
    const fields = [
      field({ key: "q1", label: "Q1", audience: "all" }),
      field({
        key: "slides",
        label: "Slides",
        audience: "presenter",
        required: true,
      }),
    ];
    // Attendee: the presenter field is not applicable, so an answer to it is
    // an unknown key — and it is NOT required of the attendee.
    expect(
      validateSurveyResponses(fields, { q1: "ok", slides: "x" }, "attendee"),
    ).toEqual({ code: "unknownKey", key: "slides" });
    expect(validateSurveyResponses(fields, { q1: "ok" }, "attendee")).toBeNull();
    // Presenter: the presenter field becomes required.
    expect(validateSurveyResponses(fields, { q1: "ok" }, "presenter")).toEqual({
      code: "required",
      key: "slides",
    });
    expect(
      validateSurveyResponses(
        fields,
        { q1: "ok", slides: "deck" },
        "presenter",
      ),
    ).toBeNull();
  });
});
