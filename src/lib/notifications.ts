import "server-only";

import { adminAuth, adminDb } from "@/lib/firebase/admin";

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
      subject: `[JTPA] 新規プロジェクト投稿: ${opts.title}`,
      text: `${opts.ownerName} (${opts.ownerEmail}) が新しいプロジェクトを投稿しました。\n\nタイトル: ${opts.title}\n\n承認: /admin/projects/pending`,
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
      ? `[JTPA] プロジェクトが承認されました: ${opts.title}`
      : `[JTPA] プロジェクトのレビュー結果について: ${opts.title}`;
  const body =
    opts.decision === "approved"
      ? `プロジェクト「${opts.title}」が承認され、ショーケースに掲載されました。`
      : `プロジェクト「${opts.title}」のレビュー結果をお知らせします。${opts.note ? `\n\nコメント: ${opts.note}` : ""}\n\n内容を修正して再投稿いただけます。`;
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
      subject: `[JTPA] 新規ブログ記事の審査依頼: ${opts.title}`,
      text: `${opts.authorName} (${opts.authorEmail}) が新しい記事を投稿しました。\n\nタイトル: ${opts.title}\n\n審査: /admin/posts`,
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
      ? `[JTPA] ブログ記事が公開されました: ${opts.title}`
      : `[JTPA] ブログ記事のレビュー結果について: ${opts.title}`;
  const body =
    opts.decision === "published"
      ? `記事「${opts.title}」が公開されました。`
      : `記事「${opts.title}」のレビュー結果をお知らせします。${opts.note ? `\n\nコメント: ${opts.note}` : ""}\n\n内容を修正して再投稿いただけます。`;
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
      subject: `[JTPA] 新規ガイドの審査依頼: ${opts.title}`,
      text: `${opts.authorName} (${opts.authorEmail}) が新しいガイドを投稿しました。\n\nタイトル: ${opts.title}\n\n審査: /admin/guides`,
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
      ? `[JTPA] ガイドが公開されました: ${opts.title}`
      : `[JTPA] ガイドのレビュー結果について: ${opts.title}`;
  let body: string;
  if (opts.decision === "published") {
    body = `ガイド「${opts.title}」が公開されました。`;
    if (opts.promoted) {
      body +=
        `\n\nおめでとうございます！コミュニティへの貢献を確認できたので、` +
        `今後はガイドを審査なしで直接公開できるようになりました ` +
        `(contributor 権限を付与しました)。\n\n` +
        `権限の反映には一度サインアウトして再ログインが必要です。`;
    }
  } else {
    body = `ガイド「${opts.title}」のレビュー結果をお知らせします。${opts.note ? `\n\nコメント: ${opts.note}` : ""}\n\n内容を修正して再投稿いただけます。`;
  }
  await enqueueMail({
    to: opts.to,
    message: { subject: subj, text: body },
    category: `guide_${opts.decision}`,
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
      subject: `[JTPA] 繰り上げ参加のお知らせ: ${opts.eventTitle}`,
      text:
        `${opts.displayName} さん\n\n` +
        `イベント「${opts.eventTitle}」のキャンセル待ちから繰り上げで参加が確定しました。` +
        (opts.role === "presenter" ? "（発表者枠）" : "") +
        `\n\n詳細はこちら: ${eventUrl}\n\n` +
        `参加できなくなった場合は、イベントページから登録をキャンセルしてください。`,
    },
    category: "waitlist_promotion",
  });
}
