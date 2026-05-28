import "server-only";

import { adminDb } from "@/lib/firebase/admin";

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

export async function enqueueAdminNewProjectNotification(opts: {
  projectId: string;
  title: string;
  ownerName: string;
  ownerEmail: string;
}): Promise<void> {
  if (ADMIN_NOTIFICATION_RECIPIENTS.length === 0) return;
  await enqueueMail({
    to: ADMIN_NOTIFICATION_RECIPIENTS,
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
  if (ADMIN_NOTIFICATION_RECIPIENTS.length === 0) return;
  await enqueueMail({
    to: ADMIN_NOTIFICATION_RECIPIENTS,
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
