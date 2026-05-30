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
