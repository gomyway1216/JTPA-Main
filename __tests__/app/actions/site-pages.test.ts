import { beforeEach, describe, expect, it, vi } from "vitest";

// saveSitePage must SURFACE validation failures as a returned
// `{ ok: false, error }` result rather than throwing — Next.js masks
// thrown Server Action errors as a generic digest in production, so a
// throw would leave the admin staring at an opaque crash. These tests
// pin the return-not-throw contract (same as posts/events/presentations).

const requireAdminMock = vi.fn();
const docSetMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({
    collection: () => ({
      doc: () => ({
        set: (...args: unknown[]) => docSetMock(...args),
      }),
    }),
  }),
  // Unused by saveSitePage, but `@/lib/actions/shared` (where parseInput
  // lives) imports it from this module.
  adminStorage: () => ({
    bucket: () => ({ file: () => ({ delete: vi.fn() }) }),
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__server_ts__" },
}));

import { saveSitePage } from "@/app/actions/site-pages";

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue({
    uid: "admin-1",
    displayName: "Admin",
    email: "admin@x",
  });
  docSetMock.mockReset().mockResolvedValue(undefined);
  revalidatePathMock.mockReset();
});

// Validation failures come back as a result, never a throw, so the real
// message survives production error masking and the form can show it.
async function expectInputError(input: Parameters<typeof saveSitePage>[0]) {
  const result = await saveSitePage(input);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toContain("入力エラー");
  // Parse fails before anything is written.
  expect(docSetMock).not.toHaveBeenCalled();
}

describe("saveSitePage — input validation", () => {
  it("rejects an unknown slug (not in SITE_PAGE_SLUGS)", async () => {
    // Slug allowlist is a 404-prevention guard — only known slugs
    // get matching /admin and public routes.
    await expectInputError({ slug: "spam" as never, title: "T", body: "B" });
  });

  it("rejects an empty title", async () => {
    await expectInputError({ slug: "about", title: "", body: "B" });
  });

  it("rejects an empty body", async () => {
    await expectInputError({ slug: "about", title: "T", body: "" });
  });

  it("rejects a body over 50 000 chars (DoS guard)", async () => {
    await expectInputError({
      slug: "about",
      title: "T",
      body: "x".repeat(50_001),
    });
  });

  it("rejects a title over 200 chars", async () => {
    await expectInputError({
      slug: "about",
      title: "x".repeat(201),
      body: "B",
    });
  });
});

describe("saveSitePage — happy path", () => {
  it("writes with merge:true, stamps updatedAt + updatedBy, then revalidates both routes", async () => {
    const result = await saveSitePage({
      slug: "about",
      title: "JTPAとは",
      body: "edited body",
    });
    expect(result).toEqual({ ok: true });
    expect(docSetMock).toHaveBeenCalledTimes(1);
    const [doc, opts] = docSetMock.mock.calls[0] as [
      Record<string, unknown>,
      { merge: boolean },
    ];
    expect(opts).toEqual({ merge: true });
    expect(doc).toMatchObject({
      slug: "about",
      title: "JTPAとは",
      body: "edited body",
      updatedAt: "__server_ts__",
      updatedBy: {
        uid: "admin-1",
        displayName: "Admin",
        email: "admin@x",
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/about");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/about");
  });

  it("falls back to null for blank displayName / email in the audit fields", async () => {
    // Avoids storing the empty string and lets the type stay
    // string | null. Important for filtering in admin audit logs.
    requireAdminMock.mockResolvedValueOnce({
      uid: "admin-1",
      displayName: "",
      email: "",
    });
    await saveSitePage({ slug: "about", title: "T", body: "B" });
    const [doc] = docSetMock.mock.calls[0] as [Record<string, unknown>];
    const updatedBy = doc.updatedBy as { displayName: string | null; email: string | null };
    expect(updatedBy.displayName).toBeNull();
    expect(updatedBy.email).toBeNull();
  });

  it("requires admin (bubbles up FORBIDDEN from requireAdmin)", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(
      saveSitePage({ slug: "about", title: "T", body: "B" }),
    ).rejects.toThrow("FORBIDDEN");
    expect(docSetMock).not.toHaveBeenCalled();
  });
});
