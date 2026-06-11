import type { SurveyField } from "@/lib/types";

export type SurveyValidationMessages = {
  missingKey(index: number): string;
  duplicateKey(index: number, key: string): string;
  missingLabel(index: number): string;
  missingOption(index: number): string;
};

// Client-side guard for an event's questionnaire (survey) fields.
//
// The server's Zod schema requires a non-empty `key` and `label` on every
// survey field (and the form seeds a freshly-added item with an EMPTY
// label). When that unfinished item reaches `createEvent`/`updateEvent`,
// the schema throws a field-level Server Action validation error — but Next.js
// masks thrown Server Action errors as the generic "An error occurred in
// the Server Components render" digest in production, so the admin just
// sees an opaque crash and "can't save when the event has a questionnaire"
// (issue #102).
//
// Validating up front turns that into a precise, inline message and keeps
// the bad payload from ever reaching the server. Returns the first problem
// found (1-based item number) or null when every field is well-formed.
// Note we test the TRIMMED value: the server's `.min(1)` would accept a
// lone space, but a whitespace-only key/label is still meaningless.
export function validateSurveyFields(
  fields: SurveyField[],
  messages: SurveyValidationMessages,
): string | null {
  const seenKeys = new Set<string>();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const n = i + 1;
    const key = f.key.trim();
    if (!key) {
      return messages.missingKey(n);
    }
    // Responses are stored as a Record keyed by `key`, so a duplicate key
    // would silently overwrite another field's answer (and double a column
    // in the CSV export). The form seeds keys from the array length
    // (`q${len+1}`), which can collide after a middle field is removed —
    // reject it here rather than lose data. Per PR #110 Gemini review.
    if (seenKeys.has(key)) {
      return messages.duplicateKey(n, key);
    }
    seenKeys.add(key);
    if (!f.label.trim()) {
      return messages.missingLabel(n);
    }
    // A `select` with no real choices renders as an empty dropdown and is
    // never answerable — require at least one non-blank option.
    if (f.type === "select" && !f.options?.some((o) => o.trim())) {
      return messages.missingOption(n);
    }
  }
  return null;
}

// ---- server-side RSVP answer validation ----------------------------------
//
// The client (RsvpSection) only sends string answers and only RENDERS the
// fields that apply to the chosen role: `audience: "all"` fields always, plus
// `audience: "presenter"` fields when role === "presenter". It also marks
// `required` fields with the native `required` attribute and constrains a
// `select` to the field's `<option>`s. None of that binds a hand-crafted
// request, so `submitRsvp` re-checks the same rules on the server before the
// answers reach Firestore.
//
// Per-answer cap. Survey answers are short free-text/选択 values; a multi-KB
// blob is abuse, not a real answer. Mirrors the spirit of the length caps the
// event/profile Zod schemas already enforce elsewhere.
export const MAX_SURVEY_ANSWER_LENGTH = 2000;

export type SurveyResponseError =
  // A required field for the active audience had no (non-blank) answer.
  | { code: "required"; key: string }
  // A select answer was not one of the field's allowed options.
  | { code: "option"; key: string }
  // A checkbox answer was something other than "true"/"false".
  | { code: "checkbox"; key: string }
  // An answer exceeded MAX_SURVEY_ANSWER_LENGTH.
  | { code: "tooLong"; key: string }
  // A response key did not match any field for the active audience.
  | { code: "unknownKey"; key: string };

// Which survey fields a given RSVP role must answer. Mirrors RsvpSection:
// everyone answers the "all" fields; only a presenter answers the
// "presenter" fields. (Presenter fields are hidden — and therefore never
// required — for an attendee.)
function fieldsForRole(
  fields: SurveyField[],
  role: "attendee" | "presenter",
): SurveyField[] {
  return fields.filter(
    (f) => f.audience === "all" || role === "presenter",
  );
}

// Validate a submitted RSVP answer map against the event's survey schema for
// the chosen role. Pure (no i18n) so it gets its own unit-test surface and
// the caller maps the structured `code` to a localized message. Returns the
// FIRST problem found, or null when every answer is acceptable.
//
// Rules:
//  - required field for the active audience → must be present & non-blank
//    (a checkbox counts as "answered" only when "true");
//  - select answer (when non-blank) → must be one of the field's options;
//  - checkbox answer (when present) → must be exactly "true" or "false";
//  - any answer → at most MAX_SURVEY_ANSWER_LENGTH characters;
//  - any response key with no matching field for the active audience →
//    rejected (a stray key is either spoofed or a presenter-only answer
//    smuggled in by an attendee).
export function validateSurveyResponses(
  fields: SurveyField[],
  responses: Record<string, string>,
  role: "attendee" | "presenter",
): SurveyResponseError | null {
  const applicable = fieldsForRole(fields, role);
  const byKey = new Map(applicable.map((f) => [f.key, f]));

  // Reject unknown keys up front: a key with no applicable field can't be a
  // legitimate answer for this submission.
  for (const key of Object.keys(responses)) {
    if (!byKey.has(key)) {
      return { code: "unknownKey", key };
    }
  }

  for (const field of applicable) {
    const raw = responses[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (value.length > MAX_SURVEY_ANSWER_LENGTH) {
      return { code: "tooLong", key: field.key };
    }

    // A checkbox is stored as "true"/"false"; a required checkbox must be
    // checked ("true"). Any other value is malformed input.
    if (field.type === "checkbox") {
      if (raw !== undefined && value !== "true" && value !== "false") {
        return { code: "checkbox", key: field.key };
      }
      if (field.required && value !== "true") {
        return { code: "required", key: field.key };
      }
      continue;
    }

    if (field.required && !value) {
      return { code: "required", key: field.key };
    }

    // Only constrain a select once it has an answer — an optional select left
    // blank is fine (the form's placeholder "" option).
    if (field.type === "select" && value) {
      const allowed = (field.options ?? []).map((o) => o.trim());
      if (!allowed.includes(value)) {
        return { code: "option", key: field.key };
      }
    }
  }

  return null;
}
