import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("saveSitePage — input validation", () => {
  it("rejects an unknown slug (not in SITE_PAGE_SLUGS)", async () => {
    // Slug allowlist is a 404-prevention guard — only known slugs
    // get matching /admin and public routes.
    await expect(
      saveSitePage({
        slug: "spam" as never,
        title: "T",
        body: "B",
      }),
    ).rejects.toThrow("入力エラー");
  });

  it("rejects an empty title", async () => {
    await expect(
      saveSitePage({ slug: "about", title: "", body: "B" }),
    ).rejects.toThrow("入力エラー");
  });

  it("rejects an empty body", async () => {
    await expect(
      saveSitePage({ slug: "about", title: "T", body: "" }),
    ).rejects.toThrow("入力エラー");
  });

  it("rejects a body over 50 000 chars (DoS guard)", async () => {
    await expect(
      saveSitePage({
        slug: "about",
        title: "T",
        body: "x".repeat(50_001),
      }),
    ).rejects.toThrow("入力エラー");
  });

  it("rejects a title over 200 chars", async () => {
    await expect(
      saveSitePage({
        slug: "about",
        title: "x".repeat(201),
        body: "B",
      }),
    ).rejects.toThrow("入力エラー");
  });
});

describe("saveSitePage — happy path", () => {
  it("writes with merge:true, stamps updatedAt + updatedBy, then revalidates both routes", async () => {
    await saveSitePage({
      slug: "about",
      title: "JTPAとは",
      body: "edited body",
    });
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
