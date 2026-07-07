import { beforeEach, describe, expect, it, vi } from "vitest";

// createEvent / updateEvent / deleteEvent / cloneEvent are admin-only and
// validate input via Zod before any Firestore work. The interesting rules
// to pin: validation failures come back as { ok: false } (never a thrown
// digest), slug uniqueness is enforced/derived, deletes sweep Storage in
// the doc-first order, and clones reset all live state. Success paths end
// in a server-side redirect, which we mock to throw like the real one.

const requireAdminMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectToLocalizedPathMock = vi.fn((path: string) => {
  // redirect() throws to short-circuit rendering; mimic that so the
  // "only ever returns on failure" contract is exercised for real.
  throw new Error(`__REDIRECT__:${path}`);
});

const whereMock = vi.fn();
const limitMock = vi.fn();
const slugQueryGetMock = vi.fn();
const postSlugQueryGetMock = vi.fn();
const addMock = vi.fn();
const docGetMock = vi.fn();
const docUpdateMock = vi.fn();
const docDeleteMock = vi.fn();
const storageDeleteMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: () => requireAdminMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
  // The action also expires the cached event lists via updateTag; these
  // tests assert on revalidatePath, not tag invalidation, so a no-op stub
  // is enough to satisfy the import.
  updateTag: () => {},
}));

vi.mock("@/lib/i18n/redirects", () => ({
  redirectToLocalizedPath: (path: string) =>
    redirectToLocalizedPathMock(path),
}));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    now: () => ({ __fixed: "now" }),
    fromDate: (d: Date) => ({ __fromDate: d.toISOString() }),
    fromMillis: (ms: number) => ({ __fromMillis: ms, toMillis: () => ms }),
  },
  FieldValue: {
    delete: () => "__delete__",
    serverTimestamp: () => "__server_ts__",
  },
}));

vi.mock("@/lib/firebase/admin", () => {
  // Event actions mostly walk the `events` collection. A report article
  // slug also probes `posts` by slug so admins can't save a broken link.
  function makeSlugQuery(getMock = slugQueryGetMock) {
    const q = {
      where: (...args: unknown[]) => {
        whereMock(...args);
        return q;
      },
      limit: (n: number) => {
        limitMock(n);
        return q;
      },
      get: () => getMock(),
    };
    return q;
  }
  return {
    adminDb: () => ({
      collection: (name: string) => {
        if (name === "posts") {
          return {
            where: (...args: unknown[]) => {
              whereMock(...args);
              return makeSlugQuery(postSlugQueryGetMock);
            },
          };
        }
        if (name === "events") {
          return {
            where: (...args: unknown[]) => {
              whereMock(...args);
              return makeSlugQuery();
            },
            add: (...args: unknown[]) => addMock(...args),
            doc: (id: string) => ({
              id,
              get: () => docGetMock(),
              update: (...args: unknown[]) => docUpdateMock(...args),
              delete: () => docDeleteMock(),
            }),
          };
        }
        throw new Error(`unexpected collection: ${name}`);
      },
    }),
    adminStorage: () => ({
      bucket: () => ({
        file: (path: string) => ({ delete: () => storageDeleteMock(path) }),
      }),
    }),
  };
});

import {
  cloneEvent,
  createEvent,
  deleteEvent,
  updateEvent,
  type EventFormInput,
} from "@/app/actions/events";
import {
  DEFAULT_CHECKIN_EARLY_MINUTES,
  DEFAULT_CHECKIN_LATE_MINUTES,
} from "@/lib/check-in";

function eventInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "JTPA Salon 32",
    description: "A monthly meetup",
    startAt: "2026-07-01T19:00",
    endAt: "2026-07-01T21:00",
    locationType: "offline",
    address: "San Jose",
    capacity: 50,
    presenterCapacity: 5,
    status: "published",
    surveyFields: [],
    ...overrides,
  } as EventFormInput;
}

async function expectError(
  p: Promise<{ ok: boolean; error?: string }>,
  substr: string,
) {
  const res = await p;
  expect(res.ok).toBe(false);
  if (res.ok) throw new Error("expected an error result, but got ok");
  expect(res.error).toContain(substr);
}

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue({
    uid: "admin-1",
    displayName: "Admin",
    email: "admin@x",
    isAdmin: true,
  });
  revalidatePathMock.mockReset();
  redirectToLocalizedPathMock.mockClear();
  whereMock.mockReset();
  limitMock.mockReset();
  // Default: every requested slug is free.
  slugQueryGetMock.mockReset().mockResolvedValue({ empty: true, docs: [] });
  postSlugQueryGetMock.mockReset().mockResolvedValue({
    empty: false,
    docs: [{ id: "post-1" }],
  });
  addMock.mockReset().mockResolvedValue({ id: "new-event-1" });
  docGetMock.mockReset();
  docUpdateMock.mockReset().mockResolvedValue(undefined);
  docDeleteMock.mockReset().mockResolvedValue(undefined);
  storageDeleteMock.mockReset().mockResolvedValue(undefined);
});

describe("createEvent — auth + validation", () => {
  it("is admin-gated", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(createEvent(eventInput())).rejects.toThrow("FORBIDDEN");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("returns 入力エラー for a malformed payload without touching Firestore", async () => {
    // min(2) title — the Zod issue list must surface as a readable
    // result, not a thrown Server-Action digest.
    await expectError(createEvent(eventInput({ title: "x" })), "入力エラー");
    expect(whereMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects a slug that violates the kebab-case regex", async () => {
    await expectError(
      createEvent(eventInput({ slug: "Bad Slug!" })),
      "入力エラー",
    );
  });

  it("surfaces a slug collision as an error result", async () => {
    slugQueryGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "other-event" }],
    });
    await expectError(
      createEvent(eventInput({ slug: "taken-slug" })),
      "taken-slug",
    );
    expect(whereMock).toHaveBeenCalledWith("slug", "==", "taken-slug");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown report article slug without writing", async () => {
    postSlugQueryGetMock.mockResolvedValueOnce({ empty: true, docs: [] });
    await expectError(
      createEvent(eventInput({ reportPostSlug: "missing-report" })),
      "missing-report",
    );
    expect(whereMock).toHaveBeenCalledWith("slug", "==", "missing-report");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid local date-time range before touching Firestore", async () => {
    await expectError(
      createEvent(
        eventInput({
          startAt: "2026-06-24T20:00",
          endAt: "2026-06-24T17:30",
        }),
      ),
      "開始・終了日時",
    );
    expect(whereMock).not.toHaveBeenCalled();
    expect(addMock).not.toHaveBeenCalled();
  });
});

describe("createEvent — happy path", () => {
  it("writes defaults + zeroed counters, revalidates, redirects to the edit page", async () => {
    await expect(
      // capacity arrives as a string from the form — z.coerce handles it.
      createEvent(
        eventInput({ slug: "my-event", capacity: "50" as unknown as number }),
      ),
    ).rejects.toThrow("__REDIRECT__:/admin/events/new-event-1/edit");

    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      slug: "my-event",
      title: "JTPA Salon 32",
      status: "published",
      capacity: 50,
      presenterCapacity: 5,
      // Optional knobs get explicit defaults so the doc shape is stable.
      visibility: "public",
      timeZone: "America/Los_Angeles",
      checkInEarlyMinutes: DEFAULT_CHECKIN_EARLY_MINUTES,
      checkInLateMinutes: DEFAULT_CHECKIN_LATE_MINUTES,
      subImages: [],
      // A new event starts with empty buckets.
      rsvpCount: 0,
      presenterCount: 0,
      waitlistCount: 0,
      createdBy: "admin-1",
    });
    // Cache busts land BEFORE the redirect throws.
    expect(revalidatePathMock).toHaveBeenCalledWith("/events");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/events");
  });

  it("stores datetime-local input as an instant in the selected event time zone", async () => {
    await expect(
      createEvent(
        eventInput({
          timeZone: "America/Los_Angeles",
          startAt: "2026-06-24T17:30",
          endAt: "2026-06-24T20:00",
        }),
      ),
    ).rejects.toThrow("__REDIRECT__");

    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.timeZone).toBe("America/Los_Angeles");
    expect(payload.startAt).toEqual({
      __fromDate: "2026-06-25T00:30:00.000Z",
    });
    expect(payload.endAt).toEqual({
      __fromDate: "2026-06-25T03:00:00.000Z",
    });
  });

  it("stores a report article slug when the referenced post exists", async () => {
    await expect(
      createEvent(eventInput({ reportPostSlug: "ai-study-2-report" })),
    ).rejects.toThrow("__REDIRECT__");

    expect(whereMock).toHaveBeenCalledWith("slug", "==", "ai-study-2-report");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.reportPostSlug).toBe("ai-study-2-report");
  });

  it("trims a report article slug before validation and persistence", async () => {
    await expect(
      createEvent(eventInput({ reportPostSlug: "  ai-study-2-report  " })),
    ).rejects.toThrow("__REDIRECT__");

    expect(whereMock).toHaveBeenCalledWith("slug", "==", "ai-study-2-report");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.reportPostSlug).toBe("ai-study-2-report");
  });

  it("accepts underscores in report article slugs because post slugify preserves them", async () => {
    await expect(
      createEvent(eventInput({ reportPostSlug: "ai_study-2-report" })),
    ).rejects.toThrow("__REDIRECT__");

    expect(whereMock).toHaveBeenCalledWith("slug", "==", "ai_study-2-report");
    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.reportPostSlug).toBe("ai_study-2-report");
  });

  it("does not treat Central Time input as the same instant as Pacific Time", async () => {
    await expect(
      createEvent(
        eventInput({
          timeZone: "America/Chicago",
          startAt: "2026-06-24T17:30",
          endAt: "2026-06-24T20:00",
        }),
      ),
    ).rejects.toThrow("__REDIRECT__");

    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.timeZone).toBe("America/Chicago");
    expect(payload.startAt).toEqual({
      __fromDate: "2026-06-24T22:30:00.000Z",
    });
    expect(payload.endAt).toEqual({
      __fromDate: "2026-06-25T01:00:00.000Z",
    });
  });

  it("slugifies the title when slug is blank and keeps blank URLs as empty strings", async () => {
    // The optionalNonEmpty preprocess: "" from a blank form field must
    // not be rejected as a length/url violation.
    await expect(
      createEvent(eventInput({ slug: "", mapUrl: "", meetingUrl: "" })),
    ).rejects.toThrow("__REDIRECT__");
    const [payload] = addMock.mock.calls[0] as [
      { slug: string; location: Record<string, unknown> },
    ];
    expect(payload.slug).toBe("jtpa-salon-32");
    expect(payload.location).toMatchObject({ mapUrl: "", meetingUrl: "" });
  });
});

describe("updateEvent", () => {
  it("is admin-gated and validates before reading the doc", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(updateEvent("e1", eventInput())).rejects.toThrow(
      "FORBIDDEN",
    );
    // Bad payload: the error result comes back before any Firestore read.
    await expectError(
      updateEvent("e1", eventInput({ endAt: "" })),
      "入力エラー",
    );
    expect(docGetMock).not.toHaveBeenCalled();
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("errors when the event vanished mid-edit", async () => {
    docGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(updateEvent("e1", eventInput()), "見つかりません");
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a slug owned by ANOTHER event", async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    slugQueryGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "other-event" }],
    });
    await expectError(
      updateEvent("e1", eventInput({ slug: "taken-slug" })),
      "taken-slug",
    );
    expect(docUpdateMock).not.toHaveBeenCalled();
  });

  it("lets an event keep its own slug (self-match is not a conflict)", async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    slugQueryGetMock.mockResolvedValueOnce({
      empty: false,
      docs: [{ id: "e1" }],
    });
    await expect(
      updateEvent("e1", eventInput({ slug: "my-own-slug" })),
    ).resolves.toEqual({ ok: true });
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.slug).toBe("my-own-slug");
  });

  it("persists a status flip and normalizes legacy cover fields", async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    const res = await updateEvent(
      "e1",
      // Cancelling an event happens through this same form path —
      // status comes straight from the validated input.
      eventInput({ status: "cancelled", checkInEarlyMinutes: 30 }),
    );
    expect(res).toEqual({ ok: true });
    // No slug in the input → no uniqueness query, and no slug key in
    // the patch (a missing field must not wipe the existing slug).
    expect(whereMock).not.toHaveBeenCalled();
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch).not.toHaveProperty("slug");
    expect(patch).toMatchObject({
      status: "cancelled",
      timeZone: "America/Los_Angeles",
      checkInEarlyMinutes: 30,
      // No cover in the input → clear it, and always drop the legacy
      // coverImagePath field so old docs normalize on first edit.
      coverImage: "__delete__",
      coverImagePath: "__delete__",
      reportPostSlug: "__delete__",
      updatedAt: "__server_ts__",
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/events");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/events");
  });

  it("sweeps the orphaned cover image only AFTER the doc write", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        coverImage: { path: "events/old.png", url: "https://x/old.png" },
      }),
    });
    await updateEvent(
      "e1",
      eventInput({
        coverImage: { path: "events/new.png", url: "https://x/new.png" },
      }),
    );
    expect(storageDeleteMock).toHaveBeenCalledWith("events/old.png");
    // Write-first ordering: if the doc update fails we must not have
    // already deleted the file the doc still points to.
    expect(docUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(
      storageDeleteMock.mock.invocationCallOrder[0],
    );
  });

  it("keeps the storage object when the cover is unchanged", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        coverImage: { path: "events/same.png", url: "https://x/same.png" },
      }),
    });
    await updateEvent(
      "e1",
      eventInput({
        coverImage: { path: "events/same.png", url: "https://x/same.png" },
      }),
    );
    expect(storageDeleteMock).not.toHaveBeenCalled();
  });

  it("persists sub images and sweeps removed ones only after the doc write", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        subImages: [
          { path: "events/old-a.png", url: "https://x/old-a.png" },
          { path: "events/old-b.png", url: "https://x/old-b.png" },
        ],
      }),
    });
    const kept = { path: "events/old-b.png", url: "https://x/old-b.png" };
    const added = { path: "events/new-c.png", url: "https://x/new-c.png" };
    await updateEvent(
      "e1",
      eventInput({
        subImages: [kept, added],
      }),
    );
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.subImages).toEqual([kept, added]);
    expect(storageDeleteMock).toHaveBeenCalledWith("events/old-a.png");
    expect(storageDeleteMock).not.toHaveBeenCalledWith("events/old-b.png");
    expect(docUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(
      storageDeleteMock.mock.invocationCallOrder[0],
    );
  });

  it("updates the report article slug when the referenced post exists", async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    const res = await updateEvent(
      "e1",
      eventInput({ reportPostSlug: "ai-study-2-report" }),
    );
    expect(res).toEqual({ ok: true });
    expect(whereMock).toHaveBeenCalledWith("slug", "==", "ai-study-2-report");
    const [patch] = docUpdateMock.mock.calls[0] as [Record<string, unknown>];
    expect(patch.reportPostSlug).toBe("ai-study-2-report");
  });
});

describe("deleteEvent", () => {
  it("is admin-gated", async () => {
    requireAdminMock.mockRejectedValueOnce(new Error("FORBIDDEN"));
    await expect(deleteEvent("e1")).rejects.toThrow("FORBIDDEN");
    expect(docDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes the doc first, then sweeps storage, then redirects to the list", async () => {
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        coverImage: { path: "events/cover.png", url: "https://x/c.png" },
        subImages: [
          { path: "events/sub-a.png", url: "https://x/a.png" },
          { path: "events/sub-b.png", url: "https://x/b.png" },
        ],
      }),
    });
    // Server-side redirect (instead of client navigation) so the admin
    // never sees the deleted event's edit page 404-flash.
    await expect(deleteEvent("e1")).rejects.toThrow(
      "__REDIRECT__:/admin/events",
    );
    expect(docDeleteMock).toHaveBeenCalledTimes(1);
    expect(storageDeleteMock).toHaveBeenCalledWith("events/cover.png");
    expect(storageDeleteMock).toHaveBeenCalledWith("events/sub-a.png");
    expect(storageDeleteMock).toHaveBeenCalledWith("events/sub-b.png");
    // Doc-first: a transient Storage failure must not leave a live doc
    // pointing at a missing file.
    expect(docDeleteMock.mock.invocationCallOrder[0]).toBeLessThan(
      storageDeleteMock.mock.invocationCallOrder[0],
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/events");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/events");
  });

  it("skips the storage sweep when there is no cover image", async () => {
    docGetMock.mockResolvedValueOnce({ exists: true, data: () => ({}) });
    await expect(deleteEvent("e1")).rejects.toThrow("__REDIRECT__");
    expect(docDeleteMock).toHaveBeenCalledTimes(1);
    expect(storageDeleteMock).not.toHaveBeenCalled();
  });
});

describe("cloneEvent", () => {
  it("errors when the source event is gone", async () => {
    docGetMock.mockResolvedValueOnce({ exists: false });
    await expectError(cloneEvent("src-event"), "複製元");
    expect(addMock).not.toHaveBeenCalled();
  });

  it("copies content, resets live state, and dodges the slug collision", async () => {
    const fixedNow = new Date("2026-06-09T00:00:00Z").getTime();
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
    const ts = (ms: number) => ({ toMillis: () => ms });
    const NINETY_MIN = 90 * 60 * 1000;
    try {
      docGetMock.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          slug: "jtpa-salon-32",
          title: "JTPA Salon 32",
          description: "the original",
          startAt: ts(1_000_000),
          endAt: ts(1_000_000 + NINETY_MIN),
          timeZone: "America/Chicago",
          location: { type: "offline", address: "San Jose" },
          capacity: 30,
          presenterCapacity: 4,
          visibility: "members_only",
          surveyFields: [{ key: "q1" }],
        }),
      });
      // findFreeSlug: the source's own slug is taken, "-1" is free.
      slugQueryGetMock
        .mockResolvedValueOnce({ empty: false, docs: [{ id: "src-event" }] })
        .mockResolvedValueOnce({ empty: true, docs: [] });

      await expect(cloneEvent("src-event")).rejects.toThrow(
        "__REDIRECT__:/admin/events/new-event-1/edit",
      );

      const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
      expect(payload).toMatchObject({
        slug: "jtpa-salon-32-1",
        // Copy is visibly labelled and parked as a draft…
        title: "JTPA Salon 32 (コピー)",
        status: "draft",
        // …with the source's settings carried over…
        description: "the original",
        capacity: 30,
        presenterCapacity: 4,
        visibility: "members_only",
        timeZone: "America/Chicago",
        surveyFields: [{ key: "q1" }],
        createdBy: "admin-1",
        // …and all live counters reset (rsvps/presentations subcollections
        // belong to the original; the clone starts fresh).
        rsvpCount: 0,
        presenterCount: 0,
        waitlistCount: 0,
      });
      // Shifted a week ahead, original 90-min duration preserved.
      const start = payload.startAt as { __fromMillis: number };
      const end = payload.endAt as { __fromMillis: number };
      expect(start.__fromMillis).toBe(fixedNow + 7 * 24 * 60 * 60 * 1000);
      expect(end.__fromMillis - start.__fromMillis).toBe(NINETY_MIN);
      expect(revalidatePathMock).toHaveBeenCalledWith("/admin/events");
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("normalizes an invalid source timezone when cloning", async () => {
    const ts = (ms: number) => ({ toMillis: () => ms });
    docGetMock.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        slug: "bad-zone-event",
        title: "Bad Zone Event",
        description: "the original",
        startAt: ts(1_000_000),
        endAt: ts(1_000_000 + 60 * 60 * 1000),
        timeZone: "Mars/Olympus_Mons",
        location: { type: "offline" },
      }),
    });
    slugQueryGetMock.mockResolvedValueOnce({ empty: true, docs: [] });

    await expect(cloneEvent("src-event")).rejects.toThrow("__REDIRECT__");

    const [payload] = addMock.mock.calls[0] as [Record<string, unknown>];
    expect(payload.timeZone).toBe("America/Los_Angeles");
  });
});
