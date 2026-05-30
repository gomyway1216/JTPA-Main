import { describe, expect, it } from "vitest";

import {
  defaultActionError,
  formatActionError,
} from "@/lib/i18n/action-errors";

describe("action error formatting", () => {
  it("keeps persisted default-copy text anchored to the default locale", () => {
    expect(defaultActionError("copySuffix")).toBe("(コピー)");
    expect(formatActionError("en", "copySuffix")).toBe("(copy)");
  });
});
