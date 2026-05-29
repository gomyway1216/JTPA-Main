import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock adminDb() to a Firestore stub whose collection("mail").add()
// captures the queued doc. Each test inspects the captured payload to
// assert the subject/body/recipient/category we build.
//
// adminAuth().listUsers() is also mocked because the admin-notification
// helpers now query Auth for users with admin / editor claims. Default
// stub returns "no users" so the existing "skips when env var empty"
// tests still observe an empty recipient list.

const addMock = vi.fn();
const collectionMock = vi.fn(() => ({ add: addMock }));
const listUsersMock = vi.fn();

vi.mock("@/lib/firebase/admin", () => ({
  adminDb: () => ({ collection: collectionMock }),
  adminAuth: () => ({ listUsers: listUsersMock }),
}));

async function importFresh() {
  // ADMIN_NOTIFICATION_RECIPIENTS is parsed once at module load — we
  // reset modules per test so env-var changes take effect.
  vi.resetModules();
  return await import("@/lib/notifications");
}

// Convenience helper for building Auth user stubs matching the shape
// `adminAuth().listUsers()` returns. Defaults to no custom claims.
function authUser(opts: {
  uid: string;
  email?: string | null;
  claims?: Record<string, unknown>;
}) {
  return {
    uid: opts.uid,
    email: opts.email ?? null,
    customClaims: opts.claims,
  };
}

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  addMock.mockReset();
  addMock.mockResolvedValue({ id: "mail-id" });
  collectionMock.mockClear();
  listUsersMock.mockReset();
  // Default: no admin/editor users in Auth — keeps the env-var-empty
  // tests below observing an empty recipient list.
  listUsersMock.mockResolvedValue({ users: [], pageToken: undefined });
  // Start from a clean env each test so module-load reads are predictable.
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ADMIN_NOTIFICATION_EMAILS;
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("enqueueMail", () => {
  it("writes to the 'mail' collection with a createdAt stamp", async () => {
    const { enqueueMail } = await importFresh();
    await enqueueMail({
      to: "test@example.com",
      message: { subject: "s", text: "t" },
    });
    expect(collectionMock).toHaveBeenCalledWith("mail");
    expect(addMock).toHaveBeenCalledTimes(1);
    const payload = addMock.mock.calls[0][0] as {
      to: string;
      message: { subject: string };
      createdAt: Date;
    };
    expect(payload.to).toBe("test@example.com");
    expect(payload.message.subject).toBe("s");
    expect(payload.createdAt).toBeInstanceOf(Date);
  });

  it("swallows Firestore errors so a mail failure can't break the action", async () => {
    // The mail queue is best-effort; the user-visible action that
    // triggered it should still succeed even when the mail write
    // explodes.
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    addMock.mockRejectedValueOnce(new Error("boom"));
    const { enqueueMail } = await importFresh();
    await expect(
      enqueueMail({ to: "a@b", message: { subject: "x" } }),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("enqueueAdminNewProjectNotification", () => {
  it("skips the enqueue when env var empty AND no admin/editor users exist", async () => {
    // No recipients configured AND no admin / editor users in Auth →
    // we must not write a half-formed mail doc that nobody can receive.
    // The Auth listUsers stub already defaults to an empty page.
    const { enqueueAdminNewProjectNotification } = await importFresh();
    await enqueueAdminNewProjectNotification({
      projectId: "p1",
      title: "T",
      ownerName: "Alice",
      ownerEmail: "a@b",
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("sends to each comma-separated env var recipient with subject + body", async () => {
    process.env.ADMIN_NOTIFICATION_EMAILS = "admin1@x, admin2@x ,admin3@x";
    const { enqueueAdminNewProjectNotification } = await importFresh();
    await enqueueAdminNewProjectNotification({
      projectId: "p1",
      title: "My Project",
      ownerName: "Alice",
      ownerEmail: "alice@example.com",
    });
    expect(addMock).toHaveBeenCalledTimes(1);
    const payload = addMock.mock.calls[0][0] as {
      to: string[];
      message: { subject: string; text: string };
      category: string;
      metadata: { projectId: string };
    };
    // Whitespace must be trimmed off each entry. Order from env var
    // matches insertion order because the Set is seeded from the array.
    expect(payload.to).toEqual(["admin1@x", "admin2@x", "admin3@x"]);
    expect(payload.message.subject).toContain("My Project");
    expect(payload.message.text).toContain("Alice");
    expect(payload.message.text).toContain("alice@example.com");
    expect(payload.category).toBe("admin_project_pending");
    expect(payload.metadata).toEqual({ projectId: "p1" });
  });

  it("includes every Auth user with admin or editor claim and dedups against env var", async () => {
    // Mix of admin / editor / contributor / plain users. The notification
    // should reach admin + editor only, deduped with the env var entry.
    // Contributor and plain users must NOT receive admin notifications —
    // the role is for self-publishing guides, not moderation.
    process.env.ADMIN_NOTIFICATION_EMAILS = "ops@example.com, admin@example.com";
    listUsersMock.mockResolvedValueOnce({
      users: [
        authUser({
          uid: "u1",
          email: "admin@example.com",
          claims: { admin: true },
        }),
        authUser({
          uid: "u2",
          email: "editor@example.com",
          claims: { editor: true },
        }),
        authUser({
          uid: "u3",
          email: "contributor@example.com",
          claims: { contributor: true },
        }),
        authUser({ uid: "u4", email: "regular@example.com" }),
        // Both admin AND editor — counts once.
        authUser({
          uid: "u5",
          email: "founder@example.com",
          claims: { admin: true, editor: true },
        }),
      ],
      pageToken: undefined,
    });
    const { enqueueAdminNewProjectNotification } = await importFresh();
    await enqueueAdminNewProjectNotification({
      projectId: "p1",
      title: "T",
      ownerName: "Alice",
      ownerEmail: "a@b",
    });
    const payload = addMock.mock.calls[0][0] as { to: string[] };
    // Set order: env var entries first (insertion order preserved), then
    // Auth additions in the order they appear in the page response.
    expect(payload.to).toEqual([
      "ops@example.com",
      "admin@example.com",
      "editor@example.com",
      "founder@example.com",
    ]);
  });

  it("walks pagination until pageToken is undefined", async () => {
    // Auth lists are paginated 1000 per call. Make sure we keep walking
    // — a misconfigured loop here would silently drop admins past the
    // first page in larger projects.
    listUsersMock
      .mockResolvedValueOnce({
        users: [
          authUser({
            uid: "u1",
            email: "page1@example.com",
            claims: { admin: true },
          }),
        ],
        pageToken: "next-page",
      })
      .mockResolvedValueOnce({
        users: [
          authUser({
            uid: "u2",
            email: "page2@example.com",
            claims: { editor: true },
          }),
        ],
        pageToken: undefined,
      });
    const { enqueueAdminNewProjectNotification } = await importFresh();
    await enqueueAdminNewProjectNotification({
      projectId: "p1",
      title: "T",
      ownerName: "Alice",
      ownerEmail: "a@b",
    });
    const payload = addMock.mock.calls[0][0] as { to: string[] };
    expect(payload.to).toContain("page1@example.com");
    expect(payload.to).toContain("page2@example.com");
    expect(listUsersMock).toHaveBeenCalledTimes(2);
    expect(listUsersMock).toHaveBeenNthCalledWith(2, 1000, "next-page");
  });

  it("falls back to env var when the Auth walk throws", async () => {
    // Transient Auth API failure → still send to the env var recipients
    // so we don't silently drop the notification entirely. Better a
    // partial recipient list than no notification at all.
    process.env.ADMIN_NOTIFICATION_EMAILS = "ops@example.com";
    listUsersMock.mockRejectedValueOnce(new Error("auth API down"));
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const { enqueueAdminNewProjectNotification } = await importFresh();
    await enqueueAdminNewProjectNotification({
      projectId: "p1",
      title: "T",
      ownerName: "Alice",
      ownerEmail: "a@b",
    });
    const payload = addMock.mock.calls[0][0] as { to: string[] };
    expect(payload.to).toEqual(["ops@example.com"]);
    expect(consoleWarnSpy).toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("skips users with admin / editor claim but no email", async () => {
    // Edge case: Apple-ID users or anonymous-converted users may have a
    // claim but no email. Skipping them prevents `to` from getting a
    // null entry that breaks the Trigger Email extension.
    listUsersMock.mockResolvedValueOnce({
      users: [
        authUser({ uid: "u1", email: null, claims: { admin: true } }),
        authUser({
          uid: "u2",
          email: "real@example.com",
          claims: { admin: true },
        }),
      ],
      pageToken: undefined,
    });
    const { enqueueAdminNewProjectNotification } = await importFresh();
    await enqueueAdminNewProjectNotification({
      projectId: "p1",
      title: "T",
      ownerName: "Alice",
      ownerEmail: "a@b",
    });
    const payload = addMock.mock.calls[0][0] as { to: string[] };
    expect(payload.to).toEqual(["real@example.com"]);
  });

  it("treats non-true claim values as no claim (no truthy coercion)", async () => {
    // Same `=== true` guard as session.ts and isAdmin in users-admin.ts.
    // A custom claim like `admin: 1` or `editor: "yes"` must NOT count.
    listUsersMock.mockResolvedValueOnce({
      users: [
        authUser({
          uid: "u1",
          email: "truthy@example.com",
          claims: { admin: 1, editor: "yes" },
        }),
        authUser({
          uid: "u2",
          email: "real@example.com",
          claims: { admin: true },
        }),
      ],
      pageToken: undefined,
    });
    const { enqueueAdminNewProjectNotification } = await importFresh();
    await enqueueAdminNewProjectNotification({
      projectId: "p1",
      title: "T",
      ownerName: "Alice",
      ownerEmail: "a@b",
    });
    const payload = addMock.mock.calls[0][0] as { to: string[] };
    expect(payload.to).toEqual(["real@example.com"]);
  });
});

describe("enqueueProjectDecisionNotification", () => {
  it("uses the 'approved' subject when decision === 'approved'", async () => {
    const { enqueueProjectDecisionNotification } = await importFresh();
    await enqueueProjectDecisionNotification({
      to: "user@x",
      title: "Cool Thing",
      decision: "approved",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { subject: string; text: string };
      category: string;
    };
    expect(payload.message.subject).toContain("承認されました");
    expect(payload.message.subject).toContain("Cool Thing");
    expect(payload.category).toBe("project_approved");
  });

  it("uses the 'rejected' subject + appends note when provided", async () => {
    const { enqueueProjectDecisionNotification } = await importFresh();
    await enqueueProjectDecisionNotification({
      to: "user@x",
      title: "Cool Thing",
      decision: "rejected",
      note: "もう少しスクリーンショットが欲しいです",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { subject: string; text: string };
      category: string;
    };
    expect(payload.message.subject).toContain("レビュー結果");
    expect(payload.message.text).toContain(
      "もう少しスクリーンショットが欲しいです",
    );
    expect(payload.category).toBe("project_rejected");
  });

  it("omits the note section when note is undefined", async () => {
    const { enqueueProjectDecisionNotification } = await importFresh();
    await enqueueProjectDecisionNotification({
      to: "user@x",
      title: "T",
      decision: "rejected",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { text: string };
    };
    expect(payload.message.text).not.toContain("コメント:");
  });
});

describe("enqueuePostDecisionNotification", () => {
  it("uses 'published' subject + category", async () => {
    const { enqueuePostDecisionNotification } = await importFresh();
    await enqueuePostDecisionNotification({
      to: "user@x",
      title: "Post Title",
      decision: "published",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { subject: string };
      category: string;
    };
    expect(payload.message.subject).toContain("公開されました");
    expect(payload.category).toBe("post_published");
  });

  it("uses 'rejected' subject + category", async () => {
    const { enqueuePostDecisionNotification } = await importFresh();
    await enqueuePostDecisionNotification({
      to: "user@x",
      title: "Post Title",
      decision: "rejected",
      note: "too short",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { subject: string; text: string };
      category: string;
    };
    expect(payload.message.subject).toContain("レビュー結果");
    expect(payload.message.text).toContain("too short");
    expect(payload.category).toBe("post_rejected");
  });
});

describe("enqueueEventBlast", () => {
  it("returns early without writing when recipients is empty", async () => {
    const { enqueueEventBlast } = await importFresh();
    await enqueueEventBlast({
      recipients: [],
      subject: "s",
      text: "t",
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("BCCs every recipient and addresses the visible 'to' to the first admin", async () => {
    // BCC keeps the member list private — never expose other recipients
    // in the visible headers.
    process.env.ADMIN_NOTIFICATION_EMAILS = "ops@jtpa";
    const { enqueueEventBlast } = await importFresh();
    await enqueueEventBlast({
      recipients: ["a@x", "b@x", "c@x"],
      subject: "Heads up",
      text: "body",
      html: "<p>body</p>",
    });
    const payload = addMock.mock.calls[0][0] as {
      to: string;
      bcc: string[];
      message: { subject: string; text: string; html: string };
      category: string;
    };
    expect(payload.to).toBe("ops@jtpa");
    expect(payload.bcc).toEqual(["a@x", "b@x", "c@x"]);
    expect(payload.message.html).toBe("<p>body</p>");
    expect(payload.category).toBe("event_blast");
  });

  it("falls back to the first recipient as visible 'to' when no admin is configured", async () => {
    // Without an admin to put in the 'to' header, the Trigger Email
    // extension still requires a 'to' field — fall back to the first
    // recipient rather than skip the send.
    const { enqueueEventBlast } = await importFresh();
    await enqueueEventBlast({
      recipients: ["only@x"],
      subject: "s",
      text: "t",
    });
    const payload = addMock.mock.calls[0][0] as {
      to: string;
      bcc: string[];
    };
    expect(payload.to).toBe("only@x");
    expect(payload.bcc).toEqual(["only@x"]);
  });
});

describe("enqueueWaitlistPromotionNotification", () => {
  it("uses NEXT_PUBLIC_SITE_URL when set, stripping trailing slashes", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://jtpa.example.com///";
    const { enqueueWaitlistPromotionNotification } = await importFresh();
    await enqueueWaitlistPromotionNotification({
      to: "user@x",
      displayName: "Yudai",
      eventTitle: "AI Night",
      eventSlug: "ai-night",
      role: "attendee",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { text: string };
    };
    expect(payload.message.text).toContain(
      "https://jtpa.example.com/events/ai-night",
    );
  });

  it("falls back to a relative path when NEXT_PUBLIC_SITE_URL is unset", async () => {
    const { enqueueWaitlistPromotionNotification } = await importFresh();
    await enqueueWaitlistPromotionNotification({
      to: "user@x",
      displayName: "Yudai",
      eventTitle: "AI Night",
      eventSlug: "ai-night",
      role: "attendee",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { text: string };
    };
    expect(payload.message.text).toContain("/events/ai-night");
    expect(payload.message.text).not.toContain("undefined");
  });

  it("annotates presenter-role promotions with (発表者枠)", async () => {
    // Attendee promotion text omits this marker; presenter promotion
    // includes it so the user knows which queue they came off.
    const { enqueueWaitlistPromotionNotification } = await importFresh();
    await enqueueWaitlistPromotionNotification({
      to: "user@x",
      displayName: "Yudai",
      eventTitle: "T",
      eventSlug: "t",
      role: "presenter",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { text: string };
    };
    expect(payload.message.text).toContain("（発表者枠）");
  });

  it("does NOT annotate attendee-role promotions", async () => {
    const { enqueueWaitlistPromotionNotification } = await importFresh();
    await enqueueWaitlistPromotionNotification({
      to: "user@x",
      displayName: "Yudai",
      eventTitle: "T",
      eventSlug: "t",
      role: "attendee",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { text: string };
    };
    expect(payload.message.text).not.toContain("（発表者枠）");
  });
});

describe("enqueueAdminNewPostNotification", () => {
  it("skips when ADMIN_NOTIFICATION_EMAILS is empty", async () => {
    const { enqueueAdminNewPostNotification } = await importFresh();
    await enqueueAdminNewPostNotification({
      postId: "p1",
      title: "t",
      authorName: "a",
      authorEmail: "a@b",
    });
    expect(addMock).not.toHaveBeenCalled();
  });

  it("sends with the post-pending category + author details", async () => {
    process.env.ADMIN_NOTIFICATION_EMAILS = "admin@x";
    const { enqueueAdminNewPostNotification } = await importFresh();
    await enqueueAdminNewPostNotification({
      postId: "p1",
      title: "Hello",
      authorName: "Alice",
      authorEmail: "alice@example.com",
    });
    const payload = addMock.mock.calls[0][0] as {
      message: { subject: string; text: string };
      category: string;
      metadata: { postId: string };
    };
    expect(payload.message.subject).toContain("Hello");
    expect(payload.message.text).toContain("Alice");
    expect(payload.category).toBe("admin_post_pending");
    expect(payload.metadata).toEqual({ postId: "p1" });
  });
});
