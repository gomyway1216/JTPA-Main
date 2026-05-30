import { beforeEach, describe, expect, it, vi } from "vitest";

// createPresentation must SURFACE validation/permission failures as a
// returned `{ ok: false, error }` result rather than throwing — Next.js
// masks thrown Server Action errors as a generic digest in production, so
// a throw would leave the presenter staring at an opaque crash (issue
// #103). These tests pin the return-not-throw contract.

const requireUserMock = vi.fn();
const rsvpGetMock = vi.fn();
const presentationGetMock = vi.fn();
const presentationSetMock = vi.fn();
const revalidatePathMock = vi.fn();
const newPresentationId = "new-pres-id";

vi.mock("@/lib/auth/session", () => ({
  requireUser: () => requireUserMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "__server_ts__" },
  Timestamp: { now: () => ({ _seconds: 0, _nanoseconds: 0 }) },
}));

vi.mock("@/lib/firebase/admin", () => {
  // events/{id}.collection("rsvps").doc(uid).get()  → ensurePresenter
  // events/{id}.collection("presentations").doc().set()  → create write
  // events/{id}.collection("presentations").doc(pid).{get,set}  → update
  function presentationsCollection() {
    return {
      doc: (id?: string) => ({
        id: id ?? newPresentationId,
        get: () => presentationGetMock(),
        set: (...args: unknown[]) => presentationSetMock(...args),
      }),
    };
  }
  function rsvpsCollection() {
    return { doc: () => ({ get: () => rsvpGetMock() }) };
  }
  function eventDoc() {
    return {
      collection: (name: string) =>
        name === "rsvps"
          ? rsvpsCollection()
          : name === "presentations"
            ? presentationsCollection()
            : null,
    };
  }
  return {
    adminDb: () => ({
      collection: (name: string) =>
        name === "events" ? { doc: () => eventDoc() } : null,
    }),
    adminStorage: () => ({
      bucket: () => ({ file: () => ({ delete: vi.fn() }) }),
    }),
  };
});

import {
  createPresentation,
  updatePresentation,
} from "@/app/actions/presentations";

beforeEach(() => {
  vi.resetAllMocks();
  requireUserMock.mockResolvedValue({
    uid: "u1",
    displayName: "Taro",
    email: "taro@example.com",
  });
});

const validUrlPayload = {
  eventId: "e1",
  eventSlug: "salon-1",
  title: "My Talk",
  externalSlidesUrl: "https://docs.google.com/presentation/d/x",
};

describe("createPresentation", () => {
  it("returns an error result (never throws) when neither file nor URL is given", async () => {
    const result = await createPresentation({
      eventId: "e1",
      eventSlug: "salon-1",
      title: "My Talk",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("入力エラー");
    // Parse fails before we ever look up the RSVP.
    expect(rsvpGetMock).not.toHaveBeenCalled();
  });

  it("returns a readable error when the user is not a confirmed presenter", async () => {
    rsvpGetMock.mockResolvedValue({ exists: false });
    const result = await createPresentation(validUrlPayload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("発表者として登録されていません");
    expect(presentationSetMock).not.toHaveBeenCalled();
  });

  it("treats a waitlisted presenter as not-yet-allowed", async () => {
    rsvpGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ role: "presenter", status: "waitlist" }),
    });
    const result = await createPresentation(validUrlPayload);
    expect(result.ok).toBe(false);
    expect(presentationSetMock).not.toHaveBeenCalled();
  });

  it("writes and returns the presentation for a confirmed presenter", async () => {
    rsvpGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ role: "presenter", status: "confirmed" }),
    });
    const result = await createPresentation(validUrlPayload);
    expect(presentationSetMock).toHaveBeenCalledTimes(1);
    expect(revalidatePathMock).toHaveBeenCalledWith("/events/salon-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.presentation.id).toBe(newPresentationId);
      expect(result.presentation.title).toBe("My Talk");
      expect(result.presentation.externalSlidesUrl).toBe(
        "https://docs.google.com/presentation/d/x",
      );
      // url-only submission → undefined file fields are stripped by plainify
      expect(result.presentation.filePath).toBeUndefined();
    }
  });
});

describe("updatePresentation", () => {
  const ownedWithFile = {
    exists: true,
    data: () => ({
      presenterUid: "u1",
      presenterName: "Taro",
      eventId: "e1",
      title: "Old title",
      filePath: "presentations/e1/u1/old.pdf",
      fileUrl: "https://storage/old.pdf",
      fileName: "old.pdf",
      createdAt: { _seconds: 111, _nanoseconds: 0 },
    }),
  };

  it("replaces the whole doc (no merge) so cleared file fields are removed", async () => {
    presentationGetMock.mockResolvedValue(ownedWithFile);
    // Switch from an uploaded file to a URL-only deck — file fields cleared.
    const result = await updatePresentation({
      presentationId: "p1",
      eventId: "e1",
      eventSlug: "salon-1",
      title: "New title",
      externalSlidesUrl: "https://docs.google.com/presentation/d/y",
    });
    expect(result.ok).toBe(true);
    // A full set() — NOT set(_, { merge: true }) — is what actually drops
    // the stale filePath/fileUrl/fileName from the document.
    expect(presentationSetMock).toHaveBeenCalledTimes(1);
    const [writtenDoc, options] = presentationSetMock.mock.calls[0];
    expect(options).toBeUndefined();
    expect(writtenDoc.filePath).toBeUndefined();
    expect(writtenDoc.fileUrl).toBeUndefined();
    expect(writtenDoc.fileName).toBeUndefined();
    expect(writtenDoc.externalSlidesUrl).toBe(
      "https://docs.google.com/presentation/d/y",
    );
    // createdAt is carried forward (full replace must not lose it).
    expect(writtenDoc.createdAt).toEqual({ _seconds: 111, _nanoseconds: 0 });
  });

  it("returns a readable error (no throw) when editing someone else's deck", async () => {
    presentationGetMock.mockResolvedValue({
      exists: true,
      data: () => ({
        presenterUid: "someone-else",
        createdAt: { _seconds: 1, _nanoseconds: 0 },
      }),
    });
    const result = await updatePresentation({
      presentationId: "p1",
      eventId: "e1",
      eventSlug: "salon-1",
      title: "New title",
      externalSlidesUrl: "https://docs.google.com/presentation/d/y",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("権限");
    expect(presentationSetMock).not.toHaveBeenCalled();
  });

  it("returns a readable error when the presentation is missing", async () => {
    presentationGetMock.mockResolvedValue({ exists: false });
    const result = await updatePresentation({
      presentationId: "missing",
      eventId: "e1",
      eventSlug: "salon-1",
      title: "New title",
      externalSlidesUrl: "https://docs.google.com/presentation/d/y",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("発表資料が見つかりません");
  });
});
