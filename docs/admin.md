# Admin operations

How to run JTPA-Main as an admin. Covers granting admin, granting the lighter editor role, managing events, reviewing project submissions, exporting attendee data, and the email notification setup.

The repo is public, so this doc is also public. Nothing here is a secret — admin authorization is enforced in code (`requireAdmin()` + Firebase Auth Custom Claim), not by hiding URLs.

## Roles

| Role | What it can do | What it can't |
|---|---|---|
| `admin` (`admin: true`) | Everything below + manage roles | — |
| `editor` (`editor: true`) | Create / edit / publish / delete guides | Touch events, projects, attendees, roles |
| (none) | RSVP events, submit projects | Anything admin-only |

Editors are strictly less privileged than admins. An editor visiting any admin-only URL is redirected to `/admin/guides`.

## Granting roles (preferred: admin UI)

`/admin/users` lists every user with their current roles and last-login time. Admins can:

- Grant or revoke `editor` on any user.
- Grant or revoke `admin` on any other user. The page refuses to remove `admin` from yourself or from the last remaining admin, so it's safe to click around.

Role changes only take effect after the target user signs out and back in (the claim has to flow into a freshly minted session cookie).

A user has to sign in once before they show up in the list — there's no way to pre-grant a role to an email that's never been seen by Firebase Auth.

## Granting roles (CLI fallback)

For bootstrap (the very first admin) or recovery when the UI is unreachable:

```bash
node scripts/set-admin.mjs <email>           # grant admin
node scripts/set-admin.mjs <email> --revoke  # revoke admin
node scripts/set-editor.mjs <email>          # grant editor
node scripts/set-editor.mjs <email> --revoke # revoke editor
```

Requirements:
- ADC set up (`gcloud auth application-default login` with a Firebase IAM Editor or Owner)
- `FIREBASE_PROJECT_ID=jtpa-main` in env or `.env.local`

Same sign-out-and-back-in rule applies.

## Admin pages map

| URL | Purpose | Who |
|---|---|---|
| `/admin` | Overview cards | admin |
| `/admin/events` | Event list (with chips for メンバー限定, status badges, RSVP counts) | admin |
| `/admin/events/new` | Create event | admin |
| `/admin/events/[id]/edit` | Edit event (also where you publish, set members-only visibility, define survey fields) | admin |
| `/admin/projects` | Pending / approved project list, with approve/reject actions | admin |
| `/admin/posts` | Blog post review queue (pending) + published / drafts / rejected sections, with approve/reject actions inline | admin |
| `/admin/attendees?eventId=...` | Per-event participant list with survey responses + CSV/email export | admin |
| `/admin/guides` | Guide list (create, edit, publish, delete) | admin + editor |
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
