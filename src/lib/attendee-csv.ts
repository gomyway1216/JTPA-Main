// Pure CSV builder for the event attendee export. Kept out of the
// AttendeeExportBar client component so the (newline/quote-sensitive)
// formatting logic has a unit-test surface — see
// __tests__/lib/attendee-csv.test.ts.

import type { RsvpDoc, SurveyField } from "@/lib/types";

// Fold embedded line breaks into a single space so every record stays on
// ONE physical CSV line. RFC 4180 quoting (csvEscape below) already lets a
// field legally contain newlines, and Excel/Sheets parse those quoted
// multi-line cells correctly — but many downstream tools (and anyone
// eyeballing the file) treat each physical line as a separate record, so a
// `presentationAbstract` or textarea survey answer with hard line breaks
// looked like several broken rows. Collapsing CR/LF runs (plus the
// whitespace hugging them) keeps the export one-row-per-attendee. Per
// issue #105.
export function toSingleLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

// RFC 4180 escaping: wrap a field in double quotes when it contains a
// quote, comma, or (defensively) a line break, doubling any embedded
// quote. Applied AFTER toSingleLine, so in practice only commas/quotes
// trigger quoting — the `\n\r` branch is belt-and-suspenders.
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatResponse(
  value: string | string[] | boolean | undefined,
): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join("|"); // pipe-separated to survive comma split
  return value;
}

export function buildAttendeeCsv(
  rsvps: RsvpDoc[],
  surveyFields: SurveyField[],
): string {
  const baseHeader = [
    "displayName",
    "affiliation",
    "email",
    "role",
    "status",
    "presentationTitle",
    "presentationAbstract",
  ];
  // Survey columns are appended at the end, using the field key as the header
  // (Excel/Sheets users can rename if they want the human label).
  const surveyHeader = surveyFields.map((f) => `survey_${f.key}`);
  const header = [...baseHeader, ...surveyHeader];

  const rows = rsvps.map((r) => {
    const base = [
      r.displayName,
      r.affiliation ?? "",
      r.email,
      r.role,
      r.status,
      r.presentationTitle ?? "",
      r.presentationAbstract ?? "",
    ];
    const survey = surveyFields.map((f) => {
      // Presenter-only fields are blank for plain attendees.
      if (f.audience === "presenter" && r.role !== "presenter") return "";
      return formatResponse(r.surveyResponses?.[f.key]);
    });
    return [...base, ...survey]
      // Collapse newlines first (issue #105), then RFC-4180 escape.
      .map((v) => csvEscape(toSingleLine(String(v ?? ""))))
      .join(",");
  });
  // Prepend a UTF-8 BOM so Excel opens it without garbled Japanese.
  return "﻿" + [header.join(","), ...rows].join("\n");
}
