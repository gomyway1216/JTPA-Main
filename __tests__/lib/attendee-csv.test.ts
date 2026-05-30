import { describe, expect, it } from "vitest";

import {
  buildAttendeeCsv,
  csvEscape,
  toSingleLine,
} from "@/lib/attendee-csv";
import type { RsvpDoc, SurveyField } from "@/lib/types";

// Minimal RsvpDoc factory — only the fields the CSV builder reads matter;
// the timestamps are filler to satisfy the type.
function rsvp(partial: Partial<RsvpDoc>): RsvpDoc {
  return {
    uid: "u1",
    displayName: "Taro",
    email: "taro@example.com",
    role: "attendee",
    status: "confirmed",
    surveyResponses: {},
    createdAt: { seconds: 0, nanoseconds: 0 },
    updatedAt: { seconds: 0, nanoseconds: 0 },
    ...partial,
  };
}

describe("toSingleLine", () => {
  it("collapses CRLF / LF / CR runs into a single space", () => {
    expect(toSingleLine("line1\r\nline2")).toBe("line1 line2");
    expect(toSingleLine("line1\nline2")).toBe("line1 line2");
    expect(toSingleLine("line1\rline2")).toBe("line1 line2");
    expect(toSingleLine("a\n\n\nb")).toBe("a b");
  });

  it("absorbs whitespace hugging the break and trims the ends", () => {
    expect(toSingleLine("a  \n  b")).toBe("a b");
    expect(toSingleLine("\n  padded  \n")).toBe("padded");
  });

  it("leaves single-line text untouched", () => {
    expect(toSingleLine("already one line")).toBe("already one line");
  });
});

describe("csvEscape", () => {
  it("quotes fields with commas and doubles embedded quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""');
  });
  it("leaves plain fields unquoted", () => {
    expect(csvEscape("plain")).toBe("plain");
  });
});

describe("buildAttendeeCsv", () => {
  // The exact issue #105 scenario: a presentationAbstract with hard line
  // breaks must not split the attendee's record across multiple physical
  // CSV lines.
  it("keeps a multi-line presentationAbstract on a single record line", () => {
    const csv = buildAttendeeCsv(
      [
        rsvp({
          role: "presenter",
          presentationTitle: "My Talk",
          presentationAbstract: "First line.\r\nSecond line.\r\n\r\nThird.",
        }),
      ],
      [],
    );
    // BOM + header + exactly one data row → 2 physical lines, no more.
    const lines = csv.replace(/^\uFEFF/, "").split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("First line. Second line. Third.");
    expect(lines[1]).not.toContain("\r");
  });

  it("collapses newlines inside textarea survey answers too", () => {
    const fields: SurveyField[] = [
      {
        key: "comments",
        label: "Comments",
        type: "textarea",
        required: false,
        audience: "all",
      },
    ];
    const csv = buildAttendeeCsv(
      [rsvp({ surveyResponses: { comments: "one\ntwo\nthree" } })],
      fields,
    );
    const lines = csv.replace(/^\uFEFF/, "").split("\n");
    expect(lines).toHaveLength(2); // header + 1 row
    expect(lines[1]).toContain("one two three");
  });

  it("still RFC-4180 quotes commas after the newline collapse", () => {
    const csv = buildAttendeeCsv(
      [rsvp({ affiliation: "Acme, Inc.", presentationAbstract: "a\nb" })],
      [],
    );
    const row = csv.replace(/^\uFEFF/, "").split("\n")[1];
    expect(row).toContain('"Acme, Inc."');
    // The abstract folded to a single space-joined field (no quoting needed
    // once the newline is gone).
    expect(row).toContain("a b");
  });

  it("emits one physical line per attendee regardless of content", () => {
    const csv = buildAttendeeCsv(
      [
        rsvp({ displayName: "A", presentationAbstract: "x\ny" }),
        rsvp({ displayName: "B", surveyResponses: {} }),
        rsvp({ displayName: "C", affiliation: "multi\r\nline\r\naffil" }),
      ],
      [],
    );
    const lines = csv.replace(/^\uFEFF/, "").split("\n");
    expect(lines).toHaveLength(4); // header + 3 rows
  });
});
