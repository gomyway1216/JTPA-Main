# Admin operations

How to run JTPA-Main as an admin. Covers granting admin, managing events, reviewing project submissions, exporting attendee data, and the email notification setup.

The repo is public, so this doc is also public. Nothing here is a secret — admin authorization is enforced in code (`requireAdmin()` + Firebase Auth Custom Claim), not by hiding URLs.

## Granting admin

Admin is a Firebase Auth Custom Claim (`admin: true`), set via a CLI script.

```bash
node scripts/set-admin.mjs <email>
```

Requirements:
- ADC set up (`gcloud auth application-default login` with a Firebase IAM Editor or Owner)
- `FIREBASE_PROJECT_ID=jtpa-main` in env or `.env.local`

The granted user **must sign out and back in** before the new claim flows into their session cookie. Until they do, the app still treats them as a regular user.

Revoke:

```bash
node scripts/set-admin.mjs <email> --revoke
```

A web UI for adding/removing admins without the script is tracked in [issue #17](https://github.com/gomyway1216/JTPA-Main/issues/17).

## Admin pages map

| URL | Purpose |
|---|---|
| `/admin` | Overview cards |
| `/admin/events` | Event list (with chips for メンバー限定, status badges, RSVP counts) |
| `/admin/events/new` | Create event |
| `/admin/events/[id]/edit` | Edit event (also where you publish, set members-only visibility, define survey fields) |
| `/admin/projects` | Pending / approved project list, with approve/reject actions |
| `/admin/posts` | Blog post review queue (pending) + published / drafts / rejected sections, with approve/reject actions inline |
| `/admin/attendees?eventId=...` | Per-event participant list with survey responses + CSV/email export |

All `/admin/*` pages check the session in the page itself (`getSessionUser` + `redirect(...)` for non-admins — usually to `/admin/guides` for editors, `/` or `/login` for everyone else). `requireAdmin()` is the matching gate on Server Actions that mutate admin-only data, where a hard `FORBIDDEN` throw is the right shape.

## Event lifecycle

1. **Create draft** at `/admin/events/new`. Status defaults to `draft` — only admins can see it.
2. **Define survey fields** (optional) — pairs of `key` + `label` + `type` + `audience` (all / presenter only).
3. **Set visibility** — `公開` (default) or `メンバー限定` (logged-in only, hidden from `/events` for anonymous visitors).
4. **Flip to `公開` (published)** when ready. The event now appears on `/events`.
5. Users **RSVP** at `/events/[slug]` — name auto-filled from Google account, all survey responses captured.
6. **Presenters upload slides** below the RSVP form (own folder under `presentations/{eventId}/{uid}/...`).
7. After the event, manually flip status to `過去 (past)` (auto-transition tracked in [issue #20](https://github.com/gomyway1216/JTPA-Main/issues/20)).

## Reviewing project submissions

1. Open `/admin/projects` — pending projects appear at the top with the project details, an "アプリを開く" link, and the submitter's identity.
2. Optionally type a comment (shown to the submitter on rejection).
3. Click **承認** or **却下**.
4. Approved projects immediately appear on the public `/showcase` page.
5. Submitter notification email goes out automatically — **once issue #15 (Trigger Email setup) is done**. Until then, the mail doc is enqueued but nothing sends it.

Submitters can edit their own projects from `/my/projects`; editing flips the status back to `pending` for re-review.

## Reviewing blog post submissions

1. Open `/admin/posts` — the page shows four sections: 審査待ち, 公開中, 下書き, 却下.
2. 審査待ち cards include the cover image preview, excerpt, tags, and links to a full プレビュー (the public detail page) and to 内容を編集 (the same form authors use; admins can edit before approving to fix typos etc).
3. Optionally type a comment (shown to the author on rejection — not on approval).
4. Click **公開** or **却下**.
5. Approved posts immediately appear on `/blog` with `publishedAt` set to now (only on first publish — re-publishing an edited post preserves the original date).
6. Author notification email goes out automatically — same as projects, **gated on issue #15** for actual delivery.

Authors can edit their own posts from `/my/posts`; non-admin edits can land in either `draft` (save without resubmitting) or `pending` (resubmit for review). Admins can also edit any post via the same form (handy for typo fixes).

## Exporting attendees

Per event:

1. Open `/admin/attendees?eventId=<id>` (or use the event picker dropdown).
2. **メアドをコピー** → comma-separated emails to clipboard. Paste into Gmail BCC field; Gmail auto-parses to individual recipients.
3. **CSV ダウンロード** → UTF-8 BOM CSV with `displayName, affiliation, email, role, status, presentationTitle, presentationAbstract, survey_<key1>, survey_<key2>, ...`. Opens cleanly in Excel.
4. **フィルタ** toggle between 確定参加者のみ (default) and 全て (incl. cancelled/waitlist).
5. **詳細** column expands the `<details>` disclosure to show survey responses for each row.

The CSV approach was chosen instead of an in-app mass-mail UI because JTPA already drives a ~2000-person Google Group. See [issue #15](https://github.com/gomyway1216/JTPA-Main/issues/15) for the Trigger Email extension plan when richer mailing becomes needed.

## Mass-emailing best practices

For one-off blasts to event attendees, the export → Gmail BCC flow is fine up to ~500 recipients (Gmail webmail limit) or ~2000 (Workspace limit). For larger broadcasts use the existing Google Group address instead.

Per-event reminders, "you're in!" promotion notices, and per-recipient personalization are out of scope until issue #15 is done.

## Watching the deployment

App Hosting auto-deploys on every push to `main`. To watch:

- <https://console.firebase.google.com/u/0/project/jtpa-main/apphosting/backends/jtpa-main/locations/us-central1/rollouts>

Each rollout takes 2-3 min. When the chip shows **Current** the new revision is live.

For Cloud Run logs (useful when a Server Action errors out and Next.js shows the generic "Server Components render" message in production):

- <https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_run_revision%22%20resource.labels.service_name%3D%22jtpa-main%22?project=jtpa-main>

Filter by severity `ERROR` to find the real exception. The first time you see this kind of error, also check the relevant Server Action's input validation — most production renders that look generic trace back to a Zod error being swallowed or a Firestore write failing on undefined values.
