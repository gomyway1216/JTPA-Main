# Feature inventory

Every user-visible feature in the app, the URLs that surface it, the data it reads/writes, and where authorization is enforced. Use this as a map when picking up unfamiliar work — pair with [`data-model.md`](data-model.md) for the schema and [`architecture.md`](architecture.md) for the request lifecycle.

## Public (no sign-in needed)

| Feature | URL | Backing data | Notes |
|---|---|---|---|
| Home | `/` | `events` (next 3) + `projects` (latest 6 approved) | Server Component, `force-dynamic` |
| About | `/about` | `sitePages/about` (falls back to hardcoded defaults) | Admin-editable Markdown |
| Event list | `/events` | `events` where `status in (published, past)` and not members-only | Hides `members_only` from anonymous visitors |
| Event detail | `/events/[slug]` | `events`, `events/{id}/presentations` | Past events hide RSVP form |
| Showcase list | `/showcase` | `projects` where `status == approved` | Thumbnail fallback to first screenshot |
| Showcase detail | `/showcase/[slug]` | `projects`, `comments`, `likes` | Comments visible to all; only signed-in can post |
| Blog list | `/blog` | `posts` where `status == published` | |
| Blog detail | `/blog/[slug]` | `posts`, `comments`, `likes` | |
| Guide list | `/guide` | `guides` where `status == published` (sorted by `order`) | Community + curated; signed-in users see a 「ガイドを投稿」 CTA |
| Guide detail | `/guide/[slug]` | `guides`, `comments`, `likes` | |
| Q&A list | `/qa` | `qa` where `status == published` | No review queue — anyone can post |
| Q&A detail | `/qa/[slug]` | `qa`, `comments`, `likes` | |
| Poll list | `/poll` | `polls` where `status == published` | Multi-select voting; anyone can browse, signed-in to vote |
| Poll detail | `/poll/[slug]` | `polls`, `polls/{id}/votes`, `comments`, `likes` | Results visible to everyone; individual ballots private |
| Public profile | `/u/[uid]` | `users/{uid}` (only fields with `*Public: true`) | Email never shown publicly |
| Help | `/help` | (none — static JSX) | Japanese user guide, linked from header + footer |
| Event check-in (QR) | `/events/[slug]/checkin?t=<token>` | `events`, `rsvps` | Self check-in for signed-in attendees; walk-ins use anonymous auth → guest RSVP. 4h-before / 6h-after window enforced server-side. |

## Signed-in member

Routes under `/login`, `/my/*`, `/projects/new`, `/blog/new`, `/qa/new`. Redirects to `/login?redirect=...` when accessed unauthenticated.

| Feature | URL | What it does |
|---|---|---|
| Sign in | `/login` | Google OAuth → ID token → session cookie via `signInWithIdToken` |
| My dashboard | `/my` | Hub linking to RSVPs / projects / posts / Q&A / likes / profile |
| Event RSVP | `/events/[slug]` (form) | `submitRsvp` — transactional counter update on parent event |
| Cancel RSVP | `/my/rsvps` | `cancelRsvp` — handles promote-from-waitlist via `cancellationDeltas` |
| Presentation upload | `/events/[slug]` (presenter section) | Direct browser → Firebase Storage upload, then Server Action records `presentations/{autoId}` metadata |
| Submit project | `/projects/new` | Creates `projects/{id}` with `status: pending` |
| Manage own projects | `/my/projects`, `/my/projects/[id]/edit` | Editing flips status back to `pending` for re-review |
| Submit blog post | `/blog/new` | Creates `posts/{id}` with `status: draft` or `pending` |
| Manage own posts | `/my/posts`, `/my/posts/[id]/edit` | Save as draft or resubmit for review |
| Post Q&A | `/qa/new` | Lands directly as `published` (no review) |
| Manage own Q&A | `/my/qa`, `/qa/[slug]/edit` | |
| Submit guide | `/guide/new` | Creates `guides/{id}` with status `pending` for plain users (admin review queue); `published` directly for admin / editor / `contributor` |
| Manage own guides | `/my/guides`, `/my/guides/[id]/edit` | Edit drafts or resubmit; rejected guides surface the admin's review note |
| Create poll | `/poll/new` | Lands directly as `published`; option list frozen once `voterCount > 0` |
| Manage own polls | `/my/poll`, `/poll/[slug]/edit` | Author can edit title/description/slug; option list frozen after first vote |
| Vote in poll | `/poll/[slug]` (form) | `castPollVote` — multi-select, can change/clear vote; transactional `voterCount` + per-option counters |
| Account / profile | `/my/profile` | Edit `affiliation`, `bio`, public toggles, email opt-in |
| Comment | inline on detail pages | `postComment` — 2000 char cap, replies are linear ("Re: @author") |
| Like | inline on records + comments | `toggleLike` — transactional `likeCount` update |
| Likes received | `/my/likes` | Cross-parent feed of liked comments authored by the user |

## Admin / editor

Gated by `requireAdmin()` / `requireEditor()` / `requireContributor()` in every Server Action; the `/admin/*` layout admits both admin and editor roles, individual pages redirect editors to `/admin/guides` when they're not allowed. `contributor` is the lightweight tier auto-granted on first guide approval — it lets users skip the admin review queue for *their own* guides but doesn't unlock any `/admin/*` route.

| Feature | URL | Role | What |
|---|---|---|---|
| Dashboard | `/admin` | admin | Pending projects + posts + upcoming events |
| Events list | `/admin/events` | admin | All statuses, with 複製 (clone) action per row |
| Create event | `/admin/events/new` | admin | |
| Edit event | `/admin/events/[id]/edit` | admin | Publish, set visibility, define survey fields |
| Project review | `/admin/projects` | admin | Approve / reject pending submissions |
| Post review | `/admin/posts` | admin | Approve / reject pending blog posts |
| Attendee export | `/admin/attendees?eventId=...` | admin | Email-copy or CSV download with survey responses; opt-in-only email recipients list |
| Event check-in | `/admin/events/[id]/checkin` | admin | Generate/rotate check-in token, view QR for kiosk, manually toggle attendance per RSVP |
| Guides | `/admin/guides` | admin + editor | Review queue for pending community guides (approve auto-promotes the author to `contributor`); plus create / edit / publish / delete any guide |
| About | `/admin/about` | admin | Edit `sitePages/about` |
| Users / roles | `/admin/users` | admin | Grant or revoke `admin` / `editor` claims; opt-in-only email CSV export |
| Admin help | `/admin/help` | admin + editor | In-app operations guide, linked from `/admin` sidebar |
| Poll archive | (no dedicated UI) | admin | `setPollStatus` Server Action flips a poll to `archived` to hide from `/poll` |

## Cross-cutting helpers

| File | Purpose |
|---|---|
| `src/lib/auth/session.ts` | `getSessionUser` / `requireUser` / `requireAdmin` / `requireEditor` — single source of truth for authn/authz |
| `src/lib/comments-parent.ts` | Maps `parentType` → Firestore collection name, public URL prefix, and "is this parent publicly visible?" check |
| `src/lib/check-in.ts` | Check-in token generation (16 chars from a confusable-free alphabet), validity window (4h before / 6h after the event), QR-payload URL builder |
| `src/lib/data/serialize.ts` | `plainify()` — converts Admin SDK Timestamps to plain objects so Server → Client component handoff doesn't throw |
| `src/lib/notifications.ts` | Enqueues docs into `mail/{autoId}` for the Trigger Email extension (Resend SMTP, sending from `JTPA <noreply@bayarea-ai.com>`). `resolveAdminRecipients()` merges the `ADMIN_NOTIFICATION_EMAILS` env var with every admin / editor user from Firebase Auth, cached 5 min. |
| `src/lib/rsvp-counters.ts` | Pure-function RSVP counter math, unit-tested separately from `cancelRsvp` |
| `src/components/markdown/MarkdownBody.tsx` | Shared Markdown renderer (GFM, syntax highlighting, heading demotion, external links open in new tab) |
| `src/components/comments/CommentsSection.tsx` | Shared comment list/form used by every commentable parent |
| `src/components/likes/LikeButton.tsx` | Optimistic like toggle, used for both record and comment likes |
