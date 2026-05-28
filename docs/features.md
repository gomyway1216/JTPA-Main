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
| Guide list | `/guide` | `guides` where `status == published` (sorted by `order`) | Curated articles |
| Guide detail | `/guide/[slug]` | `guides`, `comments`, `likes` | |
| Q&A list | `/qa` | `qa` where `status == published` | No review queue — anyone can post |
| Q&A detail | `/qa/[slug]` | `qa`, `comments`, `likes` | |
| Public profile | `/u/[uid]` | `users/{uid}` (only fields with `*Public: true`) | Email never shown publicly |

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
| Account / profile | `/my/profile` | Edit `affiliation`, `bio`, public toggles, email opt-in |
| Comment | inline on detail pages | `postComment` — 2000 char cap, replies are linear ("Re: @author") |
| Like | inline on records + comments | `toggleLike` — transactional `likeCount` update |
| Likes received | `/my/likes` | Cross-parent feed of liked comments authored by the user |

## Admin / editor

Gated by `requireAdmin()` or `requireEditor()` in every Server Action; the `/admin/*` layout admits both roles, individual pages redirect editors to `/admin/guides` when they're not allowed.

| Feature | URL | Role | What |
|---|---|---|---|
| Dashboard | `/admin` | admin | Pending projects + posts + upcoming events |
| Events list | `/admin/events` | admin | All statuses, with 複製 (clone) action per row |
| Create event | `/admin/events/new` | admin | |
| Edit event | `/admin/events/[id]/edit` | admin | Publish, set visibility, define survey fields |
| Project review | `/admin/projects` | admin | Approve / reject pending submissions |
| Post review | `/admin/posts` | admin | Approve / reject pending blog posts |
| Attendee export | `/admin/attendees?eventId=...` | admin | Email-copy or CSV download with survey responses |
| Guides | `/admin/guides` | admin + editor | Create, edit, publish, delete curated articles |
| About | `/admin/about` | admin | Edit `sitePages/about` |
| Users / roles | `/admin/users` | admin | Grant or revoke `admin` / `editor` claims |

## Cross-cutting helpers

| File | Purpose |
|---|---|
| `src/lib/auth/session.ts` | `getSessionUser` / `requireUser` / `requireAdmin` / `requireEditor` — single source of truth for authn/authz |
| `src/lib/comments-parent.ts` | Maps `parentType` → Firestore collection name, public URL prefix, and "is this parent publicly visible?" check |
| `src/lib/data/serialize.ts` | `plainify()` — converts Admin SDK Timestamps to plain objects so Server → Client component handoff doesn't throw |
| `src/lib/notifications.ts` | Enqueues docs into `mail/{autoId}` for the Trigger Email extension (no-op until issue #15 lands) |
| `src/lib/rsvp-counters.ts` | Pure-function RSVP counter math, unit-tested separately from `cancelRsvp` |
| `src/components/markdown/MarkdownBody.tsx` | Shared Markdown renderer (GFM, syntax highlighting, heading demotion, external links open in new tab) |
| `src/components/comments/CommentsSection.tsx` | Shared comment list/form used by every commentable parent |
| `src/components/likes/LikeButton.tsx` | Optimistic like toggle, used for both record and comment likes |
