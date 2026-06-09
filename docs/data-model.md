# Data model

Firestore collections and the rules that protect them. All field types live in `src/lib/types.ts`.

## Collections at a glance

```
users/{uid}
events/{eventId}
  ├─ rsvps/{uid}
  └─ presentations/{autoId}
projects/{projectId}
  ├─ comments/{commentId}
  │   └─ likes/{uid}
  └─ likes/{uid}
posts/{postId}
  ├─ comments/{commentId}
  │   └─ likes/{uid}
  └─ likes/{uid}
guides/{guideId}
  ├─ comments/{commentId}
  │   └─ likes/{uid}
  └─ likes/{uid}
qa/{qaId}
  ├─ comments/{commentId}
  │   └─ likes/{uid}
  └─ likes/{uid}
polls/{pollId}
  ├─ votes/{uid}        ← one ballot per voter (Admin-SDK-only writes)
  ├─ comments/{commentId}
  │   └─ likes/{uid}
  └─ likes/{uid}
sitePages/{slug}      ← admin-edited static-ish content (currently just `about`)
mail/{autoId}         ← Trigger Email extension (writes only via Admin SDK)
```

Comments and likes use the same shape across all five "content parent" types
(`post` / `guide` / `qa` / `project` / `poll`). The shared helpers live in
`src/lib/comments-parent.ts` (URL prefix mapping + visibility check) and
`src/lib/data/comments.ts` (queries). `CommentDoc.parentType` is denormalized
into every comment so we can build cross-parent activity feeds (e.g.
`/my/likes`) without re-deriving from the doc path.

## `users/{uid}`

Bootstrapped on first sign-in by `signInWithIdToken` (`src/app/actions/auth.ts`). Mirrors the Firebase Auth identity plus app-specific fields.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Same as the doc id, redundant on purpose for collection-group queries |
| `email` | string | From Google OAuth |
| `displayName` | string | From Google OAuth (falls back to email prefix) |
| `photoURL` | string \| null | From Google OAuth |
| `affiliation` | string? | Free text. Edited by the user on `/my/profile` and visible on `/u/[uid]` iff `affiliationPublic === true`. |
| `bio` | string? | Plain-text self-introduction (multi-line; rendered with `whitespace-pre-wrap`). Visible on `/u/[uid]` iff `bioPublic === true`. |
| `affiliationPublic`, `bioPublic` | boolean? | Per-field public/private toggles. Default `false` on older docs (opt-in migration). Email is **never** publicly toggleable. |
| `emailOptIn` | boolean | Defaults to `true`; gate for future notification opt-out. |
| `eventAttendanceCount` | number? | Cumulative count of events where the user was marked attended. Updated by QR check-in and admin attendance toggles; admin can correct it on `/admin/users`. Missing = 0 on legacy docs. |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**: self-read, self-write (uid + email immutable) except `eventAttendanceCount`, which is server/admin-managed. Admins can read all.
The public profile loader (`getPublicProfile` in `src/lib/data/users.ts`)
goes through Admin SDK and only returns the fields the user has flagged
public plus the cumulative attendance count; it does **not** rely on rules.

**`admin: true` and `editor: true` live on Firebase Auth Custom Claims, NOT here.** See [`admin.md`](admin.md#granting-roles-preferred-admin-ui) for why.

## `events/{eventId}`

| Field | Type | Notes |
|---|---|---|
| `slug` | string | URL-safe; auto-generated from title via `slugify()`. Unique across collection. |
| `title`, `description` | string | |
| `startAt`, `endAt` | Timestamp | |
| `location` | object | `{ type: "online"\|"offline"\|"hybrid", address?, mapUrl?, meetingUrl? }` |
| `capacity` | number | `0` = unlimited |
| `presenterCapacity` | number | `0` = unlimited |
| `status` | enum | `"draft" \| "published" \| "past" \| "cancelled"` |
| `visibility` | enum? | `"public" \| "members_only"` (optional; missing = public for back-compat) |
| `coverImage` | `{ path, url }?` | Optional cover image. Same `{path, url}` shape as `ProjectDoc.thumbnail` / `PostDoc.coverImage`. Shown on `/events` cards and at the top of `/events/[slug]`. Files live at `events/{adminUid}/<ts>-<file>` and are best-effort deleted on event delete or cover replacement. Older docs may carry a legacy `coverImagePath: string`; `updateEvent` removes it on next save. |
| `surveyFields` | `SurveyField[]` | See below |
| `rsvpCount`, `presenterCount`, `waitlistCount` | number | Denormalized counters, updated in transactions by `submitRsvp` / `cancelRsvp` |
| `attendanceCount` | number? | Denormalized count of RSVPs with `attendedAt` set. Updated transactionally by the check-in Server Actions. Missing = 0 on legacy docs. |
| `checkInToken` | string? | 16-char alphanumeric token (confusable-free alphabet) embedded in the QR-code URL. Admin generates/rotates via `generateCheckInToken` on `/admin/events/[id]/checkin`. Missing = token not yet issued. |
| `checkInEarlyMinutes`, `checkInLateMinutes` | number? | Per-event QR validity buffers in minutes. Missing = defaults from `src/lib/check-in.ts` (currently 4 hours before start, 6 hours after end). Admin edits these from the event edit form. |
| `createdBy` | string (uid) | |
| `createdAt`, `updatedAt` | Timestamp | |

**Survey field shape:**
```ts
{
  key: string,           // unique within event
  label: string,         // displayed to user
  type: "text" | "textarea" | "select" | "checkbox",
  required: boolean,
  options?: string[],    // for "select"
  audience: "all" | "presenter"
}
```

**Rules**:
- Public reads if `status in (published, past) AND visibility != "members_only"`
- Members-only reads if `status in (published, past) AND isSignedIn()`
- Admins read everything, including drafts
- Writes admin-only

### `events/{eventId}/rsvps/{uid}`

One RSVP per user per event. Doc id = user uid.

| Field | Type | Notes |
|---|---|---|
| `uid`, `displayName`, `email` | string | Denormalized from auth at write time |
| `affiliation` | string? | What the user typed in the RSVP form |
| `role` | enum | `"attendee" \| "presenter"` |
| `status` | enum | `"confirmed" \| "waitlist" \| "cancelled"` |
| `surveyResponses` | `Record<string, string \| string[] \| boolean>` | Keyed by survey field `key` |
| `presentationTitle`, `presentationAbstract` | string? | Free text the presenter typed at signup. Independent of any uploaded presentation doc (see below) |
| `attendedAt` | Timestamp? | Set when the attendee checks in (QR self check-in, walk-in guest, or admin manual toggle). Missing = not checked in. **Server-managed** — clients cannot set or change this field, even on their own doc. |
| `isGuest` | boolean? | Legacy marker for older walk-in guest RSVPs. Current QR check-in sends logged-out visitors through Google login and returns them to the check-in URL. **Server-managed**, same as `attendedAt`. |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**: self-read, self-write — but `attendedAt` and `isGuest` are explicitly blocklisted from both create and update (rules use `!('attendedAt' in request.resource.data)` and `.diff(resource.data).affectedKeys().hasAny(['attendedAt', 'isGuest'])`). Only Admin SDK writes (from `selfCheckIn` / `setAttendance` Server Actions) can touch them. Admins can do everything.

**Transactional counters**: `submitRsvp` (`src/app/actions/rsvps.ts`) maintains `rsvpCount` / `presenterCount` / `waitlistCount` on the parent event doc inside the transaction. Check-in Server Actions maintain `events/{id}.attendanceCount` and `users/{uid}.eventAttendanceCount` the same way. Don't update the RSVP doc outside those paths or counters drift.

### `events/{eventId}/presentations/{autoId}`

Optional uploaded slides/talks. **One presenter can have N entries** per event (the doc id is an auto-id, not the uid).

| Field | Type | Notes |
|---|---|---|
| `eventId` | string | Redundant with the parent; kept for collection-group queries |
| `presenterUid`, `presenterName` | string | Owner |
| `title` | string | Per-presentation; not synced with `RsvpDoc.presentationTitle` |
| `abstract` | string? | |
| `filePath`, `fileUrl`, `fileName` | string? | Set when a file was uploaded |
| `externalSlidesUrl` | string? | URL alternative; can co-exist with file |
| `createdAt`, `updatedAt` | Timestamp | |

Either `filePath`+`fileUrl` or `externalSlidesUrl` must be set (enforced in the Server Action), and both can co-exist (e.g. slides PDF + recording link).

**Rules**: public read, presenter-or-admin write (gated on `presenterUid == auth.uid`).

## `projects/{projectId}` (Showcase)

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique |
| `ownerUid`, `ownerName` | string | |
| `title`, `description` | string | |
| `tags` | string[] | Max 10 |
| `appUrl` | string | Required |
| `repoUrl`, `demoVideoUrl` | string? | Optional |
| `thumbnail` | `{ path, url }?` | Optional cover image. Falls back to the first screenshot on the public list when not set. |
| `screenshots` | `{ path, url }[]` | Up to 8 images shown in the project detail page gallery. |
| `status` | enum | `"pending" \| "approved" \| "rejected" \| "archived"` |
| `reviewerUid` | string \| null | Set by admin on decision |
| `reviewNote` | string? | Visible to owner if rejected |
| `likeCount` | number? | Denormalized from the `likes` subcollection (missing = 0 on legacy docs) |
| `submittedAt`, `reviewedAt?`, `createdAt`, `updatedAt` | Timestamp | |

**Rules**:
- Public read only if `status == "approved"` (so pending/rejected stay private to owner+admin)
- Owners can create with `status: "pending"`, edit (which flips status back to `pending` for re-review), and delete. `likeCount` is pinned by the rules so a direct client write can't inflate it.
- Admins approve/reject (sets `status`, `reviewerUid`, `reviewNote`, `reviewedAt`)
- `comments/{commentId}` and `likes/{uid}` subcollections follow the shared pattern below. Comment reads use the project's `status == 'approved'` gate (not `'published'` like the other parent types).

Notification on decision is enqueued via `enqueueProjectDecisionNotification` — the Trigger Email extension picks it up and sends through Resend.

## `posts/{postId}` (Blog)

Community blog entries. Members can submit posts; admins approve before public release, similar to the Showcase project workflow. Distinct from `guides` — those are admin/editor-curated help articles. Both support comments and likes via the shared subcollections.

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique URL slug |
| `title`, `excerpt` | string | Excerpt shown on the list view |
| `body` | string | Markdown source, rendered via `MarkdownBody` |
| `coverImage` | `ProjectAsset?` | Optional `{path, url}` — reuses the project asset shape |
| `tags` | string[] | Up to 8 |
| `authorUid`, `authorName` | string | Denormalized from auth |
| `authorPhotoURL` | string \| null | Denormalized from auth (`null` if the user has no Google profile photo) |
| `status` | enum | `"draft" \| "pending" \| "published" \| "rejected" \| "archived"` |
| `reviewerUid` | string \| null | Set by admin on decision |
| `reviewNote` | string? | Visible to author if rejected |
| `publishedAt` | Timestamp? | Set when status flips to `published` |
| `likeCount` | number? | Denormalized from the `likes` subcollection (missing = 0 on legacy docs) |
| `submittedAt`, `reviewedAt?`, `createdAt`, `updatedAt` | Timestamp | |

**Rules**:
- Public reads only when `status == "published"` (drafts/pending/rejected stay visible to the author + admins)
- Authors create with `status in ("draft", "pending")`; admins approve to flip to `published`
- Owner edits can land in `draft` (save without resubmitting) or `pending` (resubmit for review); never directly in published/rejected/archived. `authorUid` and `reviewerUid` are immutable for owners. Admins can change anything
- `comments/{commentId}` and `likes/{uid}` subcollections follow the shared pattern below

## `qa/{qaId}` (Community Q&A)

Open-mic question/tip board. Any signed-in member can post; there's **no review queue** (unlike `posts` and `projects`). Admins can flip status to `archived` to hide spam after the fact. Comments + likes live in the same subcollection pattern as `posts`.

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique URL slug, auto-generated from title |
| `title` | string | |
| `body` | string | Markdown source |
| `tags` | string[] | Up to 8 |
| `authorUid`, `authorName`, `authorPhotoURL` | string / string / string \| null | Denormalized from auth |
| `status` | enum | `"published" \| "archived"` |
| `likeCount` | number? | Denormalized; missing = 0 |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**:
- Read: public if `status == "published"`, plus author / admin for archived
- Create: signed-in user; `authorUid` must match caller; lands directly as `published`
- Update: author can edit `title` / `body` / `tags`; `authorUid` immutable. Admin can change anything (including `status`).
- Delete: author or admin

UI: `/qa` list, `/qa/[slug]` detail, `/qa/new` + `/qa/[slug]/edit` (signed-in), `/my/qa` (author dashboard).

## `polls/{pollId}` (Community polls)

Lightweight multi-select polls. Any signed-in member can create a poll; it's published immediately. Anyone (incl. anonymous visitors) can read published polls and see the results; voting requires sign-in. Option labels are frozen as soon as the first vote lands so existing ballots stay meaningful.

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique URL slug, auto-generated from title |
| `title` | string | 2–120 chars |
| `description` | string | 0–2000 chars; rendered as plain text in current UI |
| `options` | `PollOption[]` | Each option: `{ id: string, label: string, voteCount: number }`. Frozen once `voterCount > 0`. Up to 8 options. |
| `authorUid`, `authorName`, `authorPhotoURL` | string / string / string \| null | Denormalized from auth |
| `status` | enum | `"published" \| "archived"` — lands as `published`; admin-only flip to `archived` (via `setPollStatus`) hides from `/poll` |
| `voterCount` | number | Distinct-voter count, not total selections. Maintained transactionally with each `castPollVote`. |
| `likeCount` | number? | Denormalized from the `likes` subcollection (missing = 0) |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**:
- Public reads only when `status == "published"`; archived visible to author + admin
- Create: signed-in user; `authorUid` must match caller; must start `published` with `voterCount == 0` and every `options[i].voteCount == 0` (the `optionsAllZero` helper in `firestore.rules` unrolls the array check). Timestamps pinned to `request.time`.
- Update: author can edit only `title` / `description` / `slug` / `updatedAt`. **Cannot change `options`** — option mutations go through Admin SDK-only paths. `authorUid`, `status`, `voterCount` are pinned. Admin can change anything (including `status`).
- Delete: author or admin
- `comments/{commentId}` and `likes/{uid}` subcollections follow the shared pattern below

### `polls/{pollId}/votes/{uid}`

One ballot per voter. Doc existence == voted.

| Field | Type | Notes |
|---|---|---|
| `optionIds` | string[] | The user's current selections. Empty array = un-vote; `castPollVote` then deletes the doc and decrements `voterCount` |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**: read self-only (owner or admin); **all writes denied for clients**. Every change flows through `castPollVote` (Admin SDK), which:
1. Computes per-option deltas (added vs. removed)
2. Updates `options[i].voteCount` for each touched option
3. Updates `voterCount` (only when the doc is being created or fully cleared)

…all inside a transaction so the denormalized counters never drift.

## `guides/{guideId}` (Help articles, community + curated)

Originally admin/editor-only curated reference docs. Now also accepts community submissions on the same moderation shape as `posts`: anyone signed in can write a draft or submit for review; admins approve before publish; first approval auto-promotes the author to `contributor` so their next guide skips the queue.

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique URL slug |
| `title` | string | |
| `body` | string | Markdown |
| `tags` | string[] | |
| `status` | enum | `"draft" \| "pending" \| "published" \| "rejected" \| "archived"` |
| `order` | number | Manual sort key for the `/guide` list; lower = earlier. Admin / editor set this during review; the public submission form hides the knob from non-curators. |
| `authorUid` | string? | Denormalized author identity for queries like `listMyGuides`. Optional on legacy guides created before the community-submission flow — read paths fall back to `createdBy.uid`. |
| `authorName`, `authorPhotoURL` | string / string \| null | Denormalized from auth for display. Optional on legacy guides. |
| `reviewerUid` | string \| null | Set by admin on decision. Null for guides authored directly by admin / editor / contributor (which skip review). |
| `reviewNote` | string? | Visible to author if rejected. Cleared on subsequent approval. |
| `publishedAt` | Timestamp? | Set when the guide first transitioned to `published` — same first-publish-detection trick as `posts` so re-publishing an edited guide doesn't overwrite the original date. |
| `submittedAt`, `reviewedAt?` | Timestamp? | Mirrors `posts`. Set when the author submits for review and when an admin decides. |
| `likeCount` | number? | Denormalized; missing = 0 on legacy docs |
| `createdBy`, `updatedBy` | `{ uid, displayName, email }` | Last writer identity (preserved for legacy compat — the new `authorUid` field is the canonical "who owns this"). |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules** (full block in `firestore.rules`, summarized):
- **Read**: published is public. Drafts / pending / rejected / archived: visible to admin / editor / author.
- **Create**: admin / editor may land in any status. Contributors may create their own with `draft` / `pending` / `published`. Plain signed-in users may create their own with `draft` / `pending` only — `reviewerUid` must start null so authors can't fake a reviewer.
- **Update**: admin / editor may change anything. Author may edit their own back to `draft` / `pending` (or `published` if they're a contributor / admin / editor). `authorUid` and `reviewerUid` are pinned for non-admin/editor updates.
- **Delete**: admin / editor / author of record.
- `comments/{commentId}` and `likes/{uid}` subcollections follow the shared pattern above.

The `decideGuide` Server Action (`src/app/actions/guides.ts`) also writes the `contributor: true` Firebase Auth custom claim on the author's user record when approving a guide from someone who isn't already trusted (admin / editor / contributor). The promotion is idempotent and best-effort: the guide approval is the source of truth, and if the claim write fails the admin can flip it manually from `/admin/users` later.

## Comment + like subcollections (shared shape)

These collections live under each of `posts`, `guides`, `qa`, `projects`, and `polls`:

```
{parent}/{parentId}/comments/{commentId}
{parent}/{parentId}/comments/{commentId}/likes/{uid}
{parent}/{parentId}/likes/{uid}
```

The doc shape and rules are identical across parent types; the URL prefix
(post→`/blog`, guide→`/guide`, qa→`/qa`, project→`/showcase`, poll→`/poll`)
is derived via `parentRoutePrefix` in `src/lib/comments-parent.ts`. The
"is this parent publicly visible?" check (`isParentPubliclyVisible`) gates
on `status == 'published'` for posts/guides/qa/polls and `status == 'approved'`
for projects.

### `comments/{commentId}`

| Field | Type | Notes |
|---|---|---|
| `parentType` | `"post" \| "guide" \| "qa" \| "project" \| "poll"` | Denormalized for cross-parent activity feeds |
| `parentId` | string | |
| `authorUid`, `authorName`, `authorPhotoURL` | string / string / string \| null | |
| `body` | string | Capped at 2000 chars in the Server Action (`src/app/actions/comments.ts`) |
| `parentCommentId` | string \| null | One-level reply (rendered linearly as "Re: @author", not a nested tree) |
| `likeCount` | number? | Denormalized; updated transactionally in `toggleLike` |
| `deletedAt` | Timestamp \| null | Set on soft-delete; body cleared at the same time. Admin can hard-delete. |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**:
- Read: visible if parent is publicly visible OR caller is the comment author OR admin
- Create: signed-in user on a publicly visible parent; `authorUid` must match caller
- Update: author can edit `body`; `authorUid` immutable. Admin can change anything.
- Delete: author (soft) or admin (hard)

### `likes/{uid}` (record + comment)

The doc body is just `{ createdAt }` — existence == liked, doc id == liker's uid. Two layers:

- `{parent}/{parentId}/likes/{uid}` — like on the record itself (post / guide / qa / project)
- `{parent}/{parentId}/comments/{commentId}/likes/{uid}` — like on an individual comment

Both are toggled via `toggleLike` in `src/app/actions/likes.ts`, which keeps the denormalized `likeCount` on the parent doc in sync inside a transaction.

`/my/likes` queries `comments` with `where("authorUid", "==", uid).where("likeCount", ">", 0)` via a collectionGroup — see `firestore.indexes.json` for the matching composite index.

## `sitePages/{slug}` (Admin-edited static content)

Catch-all for admin-editable static pages. Currently only `about` is wired
up; the editor at `/admin/about` writes to `sitePages/about` and the
public page at `/about` reads it via `getSitePage("about")`. The page
renders fallback content (defined in `SITE_PAGE_DEFAULTS` in
`src/lib/data/site-pages.ts`) when the doc doesn't exist yet, so a fresh
deploy is never blank.

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Same as the doc id; redundant for clarity |
| `title` | string | Used as page H1 and `<title>` |
| `body` | string | Markdown, rendered through the same `MarkdownBody` as blog/guides |
| `updatedBy` | `{ uid, displayName, email }` | |
| `updatedAt` | Timestamp | |

**Rules**: public read; write admin-only.

Allowed slugs are pinned in `SITE_PAGE_SLUGS` in `src/lib/data/site-pages.ts` —
adding a new sitePage means: (1) add the slug there, (2) add it to
`SITE_PAGE_DEFAULTS`, (3) build the public page that calls `getSitePage("<slug>")`,
(4) add a route under `/admin/<slug>` reusing `AboutForm`-style UI.

## `mail/{autoId}` (Trigger Email)

Written by `src/lib/notifications.ts` via the Admin SDK. The Firebase Trigger Email extension (`firebase/firestore-send-email@0.2.9`) watches this collection and sends via Resend SMTP (`smtp.resend.com:465`) from `JTPA <noreply@bayarea-ai.com>` — the verified Resend domain.

The extension writes a `delivery` field back onto each doc after processing (state = `SUCCESS` / `ERROR`, with the Resend message id on success). Inspect `delivery.error` if a notification fails to land.

| Field | Type | Notes |
|---|---|---|
| `to`, `cc?`, `bcc?` | string \| string[] | |
| `message` | `{ subject, text?, html? }` | |
| `category` | string? | Tag for our own logging |
| `metadata` | object? | Per-message context |
| `createdAt` | Date | |

**Rules**: no client read or write. Server-only.

## Storage layout

```
events/{anything}/...                   cover images (admin write, public read; in practice we use the admin uid for the first segment since the rule's {eventId} is a wildcard)
presentations/{eventId}/{uid}/...       slide files (presenter or admin write, public read)
projects/{uid}/...                      project thumbnails + screenshots (owner write, public read)
posts/{uid}/...                         blog cover images + inline body images (author write, public read)
guides/{guideId}/{uid}/...              guide body images (uploader-only write, public read; admin/editor can write anywhere)
guides/{guideId}/...                    legacy guide image path (admin/editor-only) — kept for existing assets
qa/{qaId}/{uid}/...                     Q&A body images (uploader-only write, public read)
users/{uid}/...                         avatars (self write, public read)
```

All paths are public-read so direct download URLs work without auth. Image-only paths reject SVG deliberately (it can carry executable markup). Write rules enforce ownership + max size: 10MB events, 50MB presentations, 5MB projects/posts/guides/qa, 2MB avatars. See `storage.rules`.

Polls don't have a storage path — descriptions are plain text in current UI, no image uploads.

## Composite indexes

Tracked in `firestore.indexes.json` (deployed by `.github/workflows/deploy-rules.yml`). Add new indexes there when a query throws the "create index" link — copy the spec from the URL Firestore generates.

Current indexes (snapshot — `firestore.indexes.json` is the source of truth):
- `events`: `status + startAt` (both directions), `status + endAt` (both directions)
- `projects`: `status + submittedAt DESC`, `ownerUid + updatedAt DESC`
- `rsvps` (collection-group): `uid + createdAt DESC`; `rsvps` (collection): `status + createdAt ASC`
- `posts`: `status + publishedAt DESC`, `status + updatedAt DESC`, `authorUid + updatedAt DESC`
- `guides`: `status + order + updatedAt`
- `qa`: `status + createdAt DESC`, `authorUid + updatedAt DESC`
- `polls`: `status + createdAt DESC`, `authorUid + updatedAt DESC`
- **`comments` collection-group**: `authorUid + likeCount DESC` — powers `/my/likes`

If you add a new sort/filter combination, prefer adding it locally + pushing rather than waiting for production to hit the missing-index error.
