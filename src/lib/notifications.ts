import "server-only";

import { getLocale } from "next-intl/server";

import { routing, type AppLocale } from "@/i18n/routing";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import enMessages from "../../messages/en.json";
import jaMessages from "../../messages/ja.json";

// The Firebase "Trigger Email" extension watches a configured collection
// (default: `mail`) and sends queued messages via SMTP/SendGrid/Resend.
// We write docs here from Server Actions using the Admin SDK, so Firestore
// rules deny client writes (see firestore.rules).

interface MailDoc {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  message: {
    subject: string;
    text?: string;
    html?: string;
  };
  // Optional metadata for our own logging.
  category?: string;
  metadata?: Record<string, unknown>;
}

const mailMessagesByLocale = {
  en: enMessages.Mail,
  ja: jaMessages.Mail,
};

type MailMessageKey = keyof typeof jaMessages.Mail;
type MailMessageValues = Record<
  string,
  string | number | boolean | null | undefined
>;

function isAppLocale(locale: string): locale is AppLocale {
  return (routing.locales as readonly string[]).includes(locale);
}

async function getMailLocale(): Promise<AppLocale> {
  try {
    const locale = await getLocale();
    if (isAppLocale(locale)) return locale;
  } catch {
    // Notification tests and background-ish calls may not have a next-intl
    // request context. Keep the app's default language for those paths.
  }
  return routing.defaultLocale;
}

function formatMailMessage(
  locale: AppLocale,
  key: MailMessageKey,
  values: MailMessageValues = {},
): string {
  const template =
    mailMessagesByLocale[locale][key] ??
    mailMessagesByLocale[routing.defaultLocale][key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined || value === null ? match : String(value);
  });
}

async function mailMessage(
  key: MailMessageKey,
  values?: MailMessageValues,
): Promise<string> {
  return formatMailMessage(await getMailLocale(), key, values);
}

async function mailNoteBlock(note?: string): Promise<string> {
  return note ? mailMessage("noteBlock", { note }) : "";
}

export async function enqueueMail(mail: MailDoc): Promise<void> {
  try {
    await adminDb().collection("mail").add({
      ...mail,
      createdAt: new Date(),
    });
  } catch (err) {
    // Don't let mail failures break the main action; just log.
    console.error("Failed to enqueue mail:", err);
  }
}

const ADMIN_NOTIFICATION_RECIPIENTS = (
  process.env.ADMIN_NOTIFICATION_EMAILS ?? ""
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Returns the recipient list for "admin" notifications (new project / blog
// post / guide submission). Two sources are merged, with dedup:
//
// 1. `ADMIN_NOTIFICATION_EMAILS` env var — fallback for people without an
//    app account (external ops contact, generic alias, etc.). Set in App
//    Hosting Console → Environment variables.
// 2. Every Firebase Auth user with `admin: true` or `editor: true` custom
//    claim — so role changes at `/admin/users` immediately update who
//    receives notifications, with no env var edit needed.
//
// `contributor: true` is intentionally NOT included: contributors are
// trusted authors for their OWN guides, but they're not moderators and
// shouldn't be paged about other people's pending submissions.
//
// Caching: the resolved list is memoized for ADMIN_RECIPIENT_CACHE_TTL_MS
// to keep notification bursts (e.g. an admin approving 5 pending guides
// in a row) from hammering `listUsers()`. 5 minutes is short enough that
// a freshly-granted role propagates quickly — recipients need to
// sign out + back in for the claim to flow into their session cookie
// anyway, which takes ~1 minute, so the cache rarely blocks a legit
// notification. The cache only stores SUCCESSFUL walks; transient
// failures fall back to env var without poisoning the cache.
//
// Partial-failure semantics: Auth emails are buffered separately and
// merged into the result only after the full pagination walk succeeds.
// A mid-walk listUsers() failure returns the env var alone, never the
// env var + a partial Auth subset (which would be impossible for the
// caller to distinguish from a complete list).
//
// Best-effort: if the Auth listUsers walk fails entirely (transient API
// error, permission issue), we log and fall back to whatever env var
// recipients exist. The caller never throws — a missed notification is
// a degraded state, not a broken Server Action.
const ADMIN_RECIPIENT_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedAdminRecipients: { value: string[]; expiresAt: number } | null = null;

export async function resolveAdminRecipients(): Promise<string[]> {
  const now = Date.now();
  if (cachedAdminRecipients && cachedAdminRecipients.expiresAt > now) {
    return cachedAdminRecipients.value;
  }

  // Seed the result Set with the env var entries, lowercased. SMTP
  // treats addresses as case-insensitive, but the Set itself compares
  // strings case-sensitively — without normalizing we'd happily keep
  // both "Admin@example.com" and "admin@example.com" in the recipient
  // list and the user would receive duplicate copies of every alert.
  const envSet = new Set<string>(
    ADMIN_NOTIFICATION_RECIPIENTS.map((email) => email.toLowerCase()),
  );

  // Buffer Auth emails out-of-band so a partial pagination walk can be
  // discarded wholesale on failure (see "Partial-failure semantics"
  // above). Only after the loop exits cleanly do we fold them into the
  // env set.
  const authEmails: string[] = [];
  try {
    let pageToken: string | undefined;
    do {
      const page = await adminAuth().listUsers(1000, pageToken);
      for (const user of page.users) {
        const claims = (user.customClaims ?? {}) as Record<string, unknown>;
        if (claims.admin === true || claims.editor === true) {
          if (user.email) authEmails.push(user.email.toLowerCase());
        }
      }
      pageToken = page.pageToken;
    } while (pageToken);
  } catch (err) {
    console.warn(
      "Failed to walk Auth users for admin recipients; falling back to env var:",
      err,
    );
    // Failure path: env-only result, NOT cached. Try again next call —
    // a transient `listUsers` outage shouldn't lock us into degraded
    // recipients for the next 5 minutes.
    return Array.from(envSet);
  }

  for (const email of authEmails) envSet.add(email);
  const result = Array.from(envSet);
  cachedAdminRecipients = {
    value: result,
    expiresAt: now + ADMIN_RECIPIENT_CACHE_TTL_MS,
  };
  return result;
}

export async function enqueueAdminNewProjectNotification(opts: {
  projectId: string;
  title: string;
  ownerName: string;
  ownerEmail: string;
}): Promise<void> {
  const recipients = await resolveAdminRecipients();
  if (recipients.length === 0) return;
  await enqueueMail({
    to: recipients,
    message: {
      subject: await mailMessage("adminNewProjectSubject", {
        title: opts.title,
      }),
      text: await mailMessage("adminNewProjectText", {
        ownerName: opts.ownerName,
        ownerEmail: opts.ownerEmail,
        title: opts.title,
      }),
    },
    category: "admin_project_pending",
    metadata: { projectId: opts.projectId },
  });
}

export async function enqueueProjectDecisionNotification(opts: {
  to: string;
  title: string;
  decision: "approved" | "rejected";
  note?: string;
}): Promise<void> {
  const subj =
    opts.decision === "approved"
      ? await mailMessage("projectApprovedSubject", { title: opts.title })
      : await mailMessage("projectRejectedSubject", { title: opts.title });
  const noteBlock = await mailNoteBlock(opts.note);
  const body =
    opts.decision === "approved"
      ? await mailMessage("projectApprovedText", { title: opts.title })
      : await mailMessage("projectRejectedText", {
          title: opts.title,
          noteBlock,
        });
  await enqueueMail({
    to: opts.to,
    message: { subject: subj, text: body },
    category: `project_${opts.decision}`,
  });
}

export async function enqueueEventBlast(opts: {
  recipients: string[];
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  if (opts.recipients.length === 0) return;
  // Trigger Email extension handles each doc as one message; we BCC to avoid
  // disclosing the recipient list.
  await enqueueMail({
    to: ADMIN_NOTIFICATION_RECIPIENTS[0] ?? opts.recipients[0],
    bcc: opts.recipients,
    message: {
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    },
    category: "event_blast",
  });
}

export async function enqueueAdminNewPostNotification(opts: {
  postId: string;
  title: string;
  authorName: string;
  authorEmail: string;
}): Promise<void> {
  const recipients = await resolveAdminRecipients();
  if (recipients.length === 0) return;
  await enqueueMail({
    to: recipients,
    message: {
      subject: await mailMessage("adminNewPostSubject", {
        title: opts.title,
      }),
      text: await mailMessage("adminNewPostText", {
        authorName: opts.authorName,
        authorEmail: opts.authorEmail,
        title: opts.title,
      }),
    },
    category: "admin_post_pending",
    metadata: { postId: opts.postId },
  });
}

export async function enqueuePostDecisionNotification(opts: {
  to: string;
  title: string;
  decision: "published" | "rejected";
  note?: string;
}): Promise<void> {
  const subj =
    opts.decision === "published"
      ? await mailMessage("postPublishedSubject", { title: opts.title })
      : await mailMessage("postRejectedSubject", { title: opts.title });
  const noteBlock = await mailNoteBlock(opts.note);
  const body =
    opts.decision === "published"
      ? await mailMessage("postPublishedText", { title: opts.title })
      : await mailMessage("postRejectedText", {
          title: opts.title,
          noteBlock,
        });
  await enqueueMail({
    to: opts.to,
    message: { subject: subj, text: body },
    category: `post_${opts.decision}`,
  });
}

export async function enqueueAdminNewGuideNotification(opts: {
  guideId: string;
  title: string;
  authorName: string;
  authorEmail: string;
}): Promise<void> {
  const recipients = await resolveAdminRecipients();
  if (recipients.length === 0) return;
  await enqueueMail({
    to: recipients,
    message: {
      subject: await mailMessage("adminNewGuideSubject", {
        title: opts.title,
      }),
      text: await mailMessage("adminNewGuideText", {
        authorName: opts.authorName,
        authorEmail: opts.authorEmail,
        title: opts.title,
      }),
    },
    category: "admin_guide_pending",
    metadata: { guideId: opts.guideId },
  });
}

// Guide approval / rejection notice to the author. The "promoted" flag
// nudges the email subject when the user was auto-granted the
// `contributor` claim on their first approved guide, so the
// "you can now self-publish next time" sentence isn't repeated for
// every subsequent approval.
export async function enqueueGuideDecisionNotification(opts: {
  to: string;
  title: string;
  decision: "published" | "rejected";
  note?: string;
  promoted?: boolean;
}): Promise<void> {
  const subj =
    opts.decision === "published"
      ? await mailMessage("guidePublishedSubject", { title: opts.title })
      : await mailMessage("guideRejectedSubject", { title: opts.title });
  let body: string;
  if (opts.decision === "published") {
    body = await mailMessage("guidePublishedText", { title: opts.title });
    if (opts.promoted) {
      body += await mailMessage("guidePromotedAppend");
    }
  } else {
    body = await mailMessage("guideRejectedText", {
      title: opts.title,
      noteBlock: await mailNoteBlock(opts.note),
    });
  }
  await enqueueMail({
    to: opts.to,
    message: { subject: subj, text: body },
    category: `guide_${opts.decision}`,
  });
}

// Admin-facing notification fired when a user submits feedback from
// /help. Goes to the same recipient list as the other admin alerts so
// editors get visibility too. Body intentionally includes the full
// submission text (truncated) — the value of this email is "can I
// triage it inline without opening a browser?". Truncation cap matches
// what fits in an iPhone mail preview without scrolling.
export async function enqueueAdminNewFeedbackNotification(opts: {
  feedbackId: string;
  body: string;
  authorName: string;
  authorEmail: string;
}): Promise<void> {
  const recipients = await resolveAdminRecipients();
  if (recipients.length === 0) return;
  const preview =
    opts.body.length > 400 ? `${opts.body.slice(0, 400)}…` : opts.body;
  // Build the canonical triage URL from NEXT_PUBLIC_SITE_URL so the
  // link actually opens in a mail client (a bare `/admin/feedback`
  // doesn't have a base to resolve against). Falls back to the
  // relative path when the env var isn't wired up — the email is
  // still readable; the link just needs a copy-paste. Mirrors the
  // same pattern as `enqueueWaitlistPromotionNotification`. Per PR
  // #88 Gemini review.
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
  const triageUrl = `${base}/admin/feedback`;
  await enqueueMail({
    to: recipients,
    message: {
      subject: await mailMessage("adminNewFeedbackSubject"),
      text: await mailMessage("adminNewFeedbackText", {
        authorName: opts.authorName,
        authorEmail: opts.authorEmail,
        preview,
        triageUrl,
      }),
    },
    category: "admin_feedback_new",
    metadata: { feedbackId: opts.feedbackId },
  });
}

// Sent when a confirmed attendee cancels and a waitlisted user gets
// auto-promoted into the freed seat (see cancelRsvp in actions/rsvps.ts).
// Best-effort — Trigger Email isn't configured yet (#15), so the doc
// just sits in the `mail` collection until the extension is installed.
// Once #15 lands the queued notification flushes through automatically.
export async function enqueueWaitlistPromotionNotification(opts: {
  to: string;
  displayName: string;
  eventTitle: string;
  eventSlug: string;
  role: "attendee" | "presenter";
}): Promise<void> {
  // Build the canonical event URL from NEXT_PUBLIC_SITE_URL when set,
  // falling back to a relative path so the email is still useful even
  // if the env var isn't wired up yet.
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
  const eventUrl = `${base}/events/${opts.eventSlug}`;

  await enqueueMail({
    to: opts.to,
    message: {
      subject: await mailMessage("waitlistSubject", {
        eventTitle: opts.eventTitle,
      }),
      text: await mailMessage("waitlistText", {
        displayName: opts.displayName,
        eventTitle: opts.eventTitle,
        roleSuffix:
          opts.role === "presenter"
            ? await mailMessage("presenterRoleSuffix")
            : "",
        eventUrl,
      }),
    },
    category: "waitlist_promotion",
  });
}
