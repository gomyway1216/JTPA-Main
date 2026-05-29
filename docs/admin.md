# Admin operations

How to run JTPA-Main as an admin. Covers granting admin / editor / contributor, managing events (including check-in), reviewing project + blog + guide submissions, exporting attendee data, editing the About page, archiving spam Q&A / polls, and the email notification setup.

The repo is public, so this doc is also public. Nothing here is a secret — admin authorization is enforced in code (`requireAdmin()` + Firebase Auth Custom Claim), not by hiding URLs.

## Roles

| Role | What it can do | What it can't |
|---|---|---|
| `admin` (`admin: true`) | Everything below + manage roles, review/approve project + blog + guide submissions, archive Q&A or polls, edit `/about`, manage events + attendees, run event check-in | — |
| `editor` (`editor: true`) | Create / edit / publish / delete **any** guide (cross-author curation) | Touch events, projects, posts, Q&A or poll moderation, attendees, About page, roles |
| `contributor` (`contributor: true`) | Self-publish their **own** guides without admin review | Edit other people's guides; everything in admin |
| signed-in user (no role) | RSVP events, self check-in at events, submit projects (admin review), submit blog posts (admin review), **submit guides (admin review on first one, then auto-promoted to `contributor`)**, post Q&A (auto-published), create polls (auto-published), vote in polls, comment on any published guide / blog / Q&A / poll / approved project, like records and comments | Anything admin/editor-only |
| anonymous | Read public content (published events, approved projects, published blog posts + guides + Q&A + polls, including poll results); walk-in check-in via the QR code at the door (uses anonymous Firebase Auth + creates a guest RSVP) | Anything that requires sign-in (RSVP, post, vote, comment, like) |

The three role claims compose independently — a user can hold `editor` without `contributor`, or both. `editor` is strictly more powerful than `contributor` (editor can edit any guide; contributor can only touch their own). Editor / contributor are both strictly less privileged than admin.

`contributor` does **not** unlock any `/admin/*` route — it only lets the holder skip the admin review queue for their own guide submissions. An editor visiting an admin-only URL is redirected to `/admin/guides` (the one admin page editors can use); a contributor or plain signed-in user gets bounced to `/` instead.

`contributor` is auto-granted on a user's first admin-approved guide so subsequent guide submissions skip the review queue — see [Reviewing guide submissions](#reviewing-guide-submissions) below. Admins can grant or revoke it manually from `/admin/users` at any time.

Q&A, polls, comments, and guides authored by admin/editor/contributor go live immediately (no review queue). Admins can hard-delete abusive comments or flip a Q&A / poll doc to `archived` after the fact. Authors can soft-delete their own comments.

## Granting roles (preferred: admin UI)

`/admin/users` lists every user with their current roles and last-login time. Admins can:

- Grant or revoke `contributor` on any user. Lower stakes than editor — contributor only affects the user's own guides — so admins can hand it out liberally to anyone showing up to write.
- Grant or revoke `editor` on any user. Editor is a curation role: editors can edit + publish + delete *anyone's* guide. Reserve for community members who have agreed to keep the guide list tidy.
- Grant or revoke `admin` on any other user. The page refuses to remove `admin` from yourself or from the last remaining admin, so it's safe to click around.

Role changes only take effect after the target user signs out and back in (the claim has to flow into a freshly minted session cookie).

A user has to sign in once before they show up in the list — there's no way to pre-grant a role to an email that's never been seen by Firebase Auth.

## Granting roles (CLI fallback)

For bootstrap (the very first admin) or recovery when the UI is unreachable:

```bash
node scripts/set-admin.mjs <email>            # grant admin
node scripts/set-admin.mjs <email> --revoke   # revoke admin
node scripts/set-editor.mjs <email>           # grant editor
node scripts/set-editor.mjs <email> --revoke  # revoke editor
node scripts/set-contributor.mjs <email>           # grant contributor
node scripts/set-contributor.mjs <email> --revoke  # revoke contributor
```

Each script is idempotent — re-running with the same arguments is a no-op.

Requirements:
- ADC set up (`gcloud auth application-default login` with a Firebase IAM Editor or Owner)
- `FIREBASE_PROJECT_ID=jtpa-main` in env or `.env.local`

Same sign-out-and-back-in rule applies.

## Notification recipients (who gets the admin emails)

Every admin notification email (new project / blog post / guide submission) is sent to the union of two sources:

1. **Every Firebase Auth user with `admin: true` or `editor: true`** — pulled live each time a notification fires, so granting / revoking roles at `/admin/users` immediately changes who receives notifications. No code change or env var edit needed.
2. **The `ADMIN_NOTIFICATION_EMAILS` env var** — comma-separated fallback for people who don't have an app account (external ops contact, a generic ops@ alias, etc.). Edit at App Hosting Console → Environment variables. See [`docs/deployment.md`](deployment.md#environment-variables).

`contributor` is intentionally not on the list — contributors can self-publish their own guides but they're not moderators, so they don't get paged about other people's pending submissions.

If both sources are empty, the notification is silently dropped (no half-formed mail doc that nobody can receive).

## Admin pages map

| URL | Purpose | Who |
|---|---|---|
| `/admin` | Overview cards | admin |
| `/admin/events` | Event list (with chips for メンバー限定, status badges, RSVP counts) | admin |
| `/admin/events/new` | Create event | admin |
| `/admin/events/[id]/edit` | Edit event (also where you publish, set members-only visibility, define survey fields) | admin |
| `/admin/events/[id]/checkin` | Generate / rotate the check-in token, render the QR code for the door kiosk, and manually toggle attendance per RSVP | admin |
| `/admin/projects` | Pending / approved project list, with approve/reject actions | admin |
| `/admin/posts` | Blog post review queue (pending) + published / drafts / rejected sections, with approve/reject actions inline | admin |
| `/admin/attendees?eventId=...` | Per-event participant list with survey responses + CSV/email export | admin |
| `/admin/guides` | Guide review queue (pending community submissions) + published / drafts / rejected sections, with approve/reject actions and the create button. Approval auto-promotes the author to `contributor`. | admin + editor |
| `/admin/feedback` | Triage queue for `/help` feedback submissions. Inline status flips (未対応 → 確認済み → 対応済み, plus admin-only アーカイブ). Mirrored email lands in the admin notification list when a new entry arrives. | admin + editor |
| `/admin/about` | Edit the `/about` page (title + Markdown body, stored in `sitePages/about`) | admin |
| `/admin/users` | User list with role grant/revoke | admin |
| `/admin/help` | In-app admin operations guide (Japanese, mirrors this doc at a high level) | admin + editor |

The `/admin/*` layout admits admins or editors; admin-only pages each add a one-line redirect (to `/admin/guides`) for editors hitting them directly. Server actions re-check with `requireAdmin()` or `requireEditor()` so the page-level guard isn't load-bearing for security.

## Seeding sample guides

A small set of starter guides ("Claude Code とは", "API キーとは", etc.) ships in `scripts/seed-guides.mjs`. Useful when bringing up a fresh environment so `/guide` isn't empty and editors have a reference for what good content looks like.

```bash
node scripts/seed-guides.mjs
```

Same credentials story as the role scripts (ADC or `FIREBASE_SERVICE_ACCOUNT`). Idempotent: re-running with the same slugs leaves existing docs alone. Edit through the admin UI, not by changing the script and re-running it.

## Event lifecycle

1. **Create draft** at `/admin/events/new` *(or click 「複製」 on a similar past event in the `/admin/events` list to copy its content + survey fields into a fresh draft)*. Status defaults to `draft` — only admins can see it.
2. **Define survey fields** (optional) — pairs of `key` + `label` + `type` + `audience` (all / presenter only).
3. **Set visibility** — `公開` (default) or `メンバー限定` (logged-in only, hidden from `/events` for anonymous visitors).
4. **Flip to `公開` (published)** when ready. The event now appears on `/events`.
5. Users **RSVP** at `/events/[slug]` — name auto-filled from Google account, all survey responses captured.
6. **Presenters upload slides** below the RSVP form (own folder under `presentations/{eventId}/{uid}/...`).
7. After the event ends, the public site automatically treats it as past (RSVP form hidden, listed under 過去のイベント). Admins can also explicitly flip status to `過去 (past)` to remove the literal "published" chip from `/admin/events`.

### Cloning an event

Recurring events (monthly meetup, repeat workshops): on `/admin/events`, click 「複製」 on the row. A new draft is created with:
- Same title (suffixed " (コピー)" — rename in the edit form)
- Same description, location, capacity, presenter capacity, survey fields, visibility
- `startAt` shifted to **today + 7 days**, `endAt` preserving the original duration
- Status reset to `draft`, all counters back to 0
- Subcollections (rsvps, presentations) **not copied** — those belong to the original event

You land on the new event's edit page to adjust dates and publish.

## Reviewing project submissions

1. Open `/admin/projects` — pending projects appear at the top with the project details, an "アプリを開く" link, and the submitter's identity.
2. Optionally type a comment (shown to the submitter on rejection).
3. Click **承認** or **却下**.
4. Approved projects immediately appear on the public `/showcase` page.
5. Submitter notification email goes out automatically — sent directly to the submitter's email via the Trigger Email extension + Resend SMTP. (This is distinct from the new-submission alert: that one fans out to admin + editor per [Notification recipients](#notification-recipients-who-gets-the-admin-emails).)

Submitters can edit their own projects from `/my/projects`; editing flips the status back to `pending` for re-review.

## Reviewing guide submissions

Anyone signed in can submit a guide from `/guide/new`. The first one lands in the admin review queue (`status: pending`); after approval the author is auto-promoted to `contributor` and follow-up guides skip the queue.

1. Open `/admin/guides` — the **審査待ち** section at the top lists pending community submissions. Each card shows title, author, tags, an excerpt of the body, and **プレビュー** / **内容を編集** links so you can read the full guide or fix typos before approving.
2. Optionally type a コメント (shown to the author on rejection — not on approval).
3. Click **公開 (+ contributor 付与)** or **却下**.
4. Approved guides immediately appear on `/guide`. The same action also grants the `contributor: true` custom claim to the author **if they don't already hold admin / editor / contributor** — that's the promotion that lets their next guide skip review.
5. Author notification email goes out automatically — same `mail/` queue + Resend SMTP as project + post decisions. The publish notice gets an extra paragraph explaining the contributor promotion when applicable.

Authors can edit their own guides from `/my/guides`; a non-trusted author's edit (no admin/editor/contributor claim) flips the status back to `pending` or stays in `draft`. Contributors and above can edit + republish their own guides directly without re-review.

Editors hold the cross-author edit power: they can edit, publish, or delete *anyone's* guide. Use editor sparingly — it's the right role for someone you trust to keep the curated guide list tidy.

If a contributor abuses the trust, demote them at `/admin/users` → **contributor 剥奪**. Their existing guides stay up; future submissions go back through the pending queue.

## Reviewing blog post submissions

1. Open `/admin/posts` — the page shows four sections: 審査待ち, 公開中, 下書き, 却下.
2. 審査待ち cards include the cover image preview, excerpt, tags, and links to a full プレビュー (the public detail page) and to 内容を編集 (the same form authors use; admins can edit before approving to fix typos etc).
3. Optionally type a comment (shown to the author on rejection — not on approval).
4. Click **公開** or **却下**.
5. Approved posts immediately appear on `/blog` with `publishedAt` set to now (only on first publish — re-publishing an edited post preserves the original date).
6. Author notification email goes out automatically — same as projects.

Authors can edit their own posts from `/my/posts`; non-admin edits can land in either `draft` (save without resubmitting) or `pending` (resubmit for review). Admins can also edit any post via the same form (handy for typo fixes).

## Event check-in (day-of)

The check-in flow lets attendees mark themselves "attended" by scanning a QR code at the door — no admin desk work required for the common case, with a manual fallback for edge cases.

1. **Generate the token** (once per event): open `/admin/events/[id]/checkin` → click **トークンを発行** (or **再発行** if rotating after a leak). This writes a 16-char alphanumeric `checkInToken` onto the event doc. The page renders a QR code embedding `https://<site>/events/<slug>/checkin?t=<token>`.
2. **Print or display** the QR. Same page → 「印刷」 prints a kiosk-friendly poster; for an iPad / TV at the door, just leave the page open.
3. **At the event** attendees scan and land on `/events/[slug]/checkin?t=<token>`:
   - **Already signed in (pre-registered RSVP)**: `selfCheckIn` records `attendedAt: now` on their RSVP doc. Idempotent — second scan does nothing.
   - **Already signed in, no RSVP yet**: same Server Action also creates a confirmed RSVP transparently before stamping `attendedAt`.
   - **Walk-in, not signed in**: the page offers a "ゲストとして入場" form (name + email). On submit, the client signs in anonymously via Firebase Auth, `guestCheckIn` verifies the ID token, creates an RSVP with `isGuest: true`, and stamps `attendedAt`. No `users/{uid}` profile is created — guest identity lives only on the RSVP.
4. **Token validity window**: 4 hours before `startAt` to 6 hours after `endAt` (constants in `src/lib/check-in.ts`). Outside that window the page rejects the token with a clear error so a leaked QR can't be replayed weeks later.
5. **Manual toggle**: `/admin/events/[id]/checkin` shows the live attendee list with a checkbox per RSVP — flip it to set/clear `attendedAt` directly. Useful when someone forgets to scan or when reversing a mistake.
6. **Counter**: `events/{id}.attendanceCount` is maintained transactionally by all three flows, so the admin page's "X / Y attended" number stays accurate without recomputing.

If a token is leaked or accidentally shared early, click **再発行** — the old token instantly stops working (event doc only holds one token at a time).

## Exporting attendees

Per event:

1. Open `/admin/attendees?eventId=<id>` (or use the event picker dropdown).
2. **メアドをコピー** → comma-separated emails to clipboard. Paste into Gmail BCC field; Gmail auto-parses to individual recipients.
3. **CSV ダウンロード** → UTF-8 BOM CSV with `displayName, affiliation, email, role, status, presentationTitle, presentationAbstract, survey_<key1>, survey_<key2>, ...`. Opens cleanly in Excel.
4. **フィルタ** toggle between 確定参加者のみ (default) and 全て (incl. cancelled/waitlist).
5. **詳細** column expands the `<details>` disclosure to show survey responses for each row.

The CSV approach is the primary path because JTPA already drives a ~2000-person Google Group — the in-app mail pipeline (Trigger Email + Resend SMTP) is now wired up too, but the UI for richer mass-mailing (per-event reminders, "you're in!" notices, per-recipient personalization) hasn't been built yet.

## Mass-emailing best practices

For one-off blasts to event attendees, the export → Gmail BCC flow is fine up to ~500 recipients (Gmail webmail limit) or ~2000 (Workspace limit). For larger broadcasts use the existing Google Group address instead.

Per-event reminders, "you're in!" promotion notices, and per-recipient personalization are still unbuilt UI on top of the now-functional `enqueueEventBlast` (and similar) helpers — a future follow-up if/when the Google Group flow stops being enough.

## Editing the `/about` page

The `/about` page reads from `sitePages/about` in Firestore; before any admin saves it, the public page falls back to copy hardcoded in `SITE_PAGE_DEFAULTS` (`src/lib/data/site-pages.ts`). To edit:

1. Open `/admin/about`
2. Edit the title + Markdown body (same renderer as guides/blog: GFM tables, syntax-highlighted code, `## headings` get demoted one level so the page H1 stays unique)
3. Save — public `/about` updates on the next request

To add another admin-edited page (e.g. `/contact`):

1. Add the slug to `SITE_PAGE_SLUGS` in `src/lib/data/site-pages.ts`
2. Add a default `{ title, body }` entry to `SITE_PAGE_DEFAULTS`
3. Create the public route (`src/app/<slug>/page.tsx`) — copy `src/app/about/page.tsx`
4. Create the admin route (`src/app/admin/<slug>/page.tsx`) — copy `src/app/admin/about/page.tsx` + its `AboutForm`

## Watching the deployment

App Hosting auto-deploys on every push to `main`. To watch:

- <https://console.firebase.google.com/u/0/project/jtpa-main/apphosting/backends/jtpa-main/locations/us-central1/rollouts>

Each rollout takes 2-3 min. When the chip shows **Current** the new revision is live.

For Cloud Run logs (useful when a Server Action errors out and Next.js shows the generic "Server Components render" message in production):

- <https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%20resource.labels.service_name%3D%22jtpa-main%22?project=jtpa-main>

Filter by severity `ERROR` to find the real exception. The first time you see this kind of error, also check the relevant Server Action's input validation — most production renders that look generic trace back to a Zod error being swallowed or a Firestore write failing on undefined values.
