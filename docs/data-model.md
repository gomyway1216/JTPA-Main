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
sitePages/{slug}      ← admin-edited static-ish content (currently just `about`)
mail/{autoId}         ← Trigger Email extension (writes only via Admin SDK)
```

Comments and likes use the same shape across all four "content parent" types
(`post` / `guide` / `qa` / `project`). The shared helpers live in
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
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**: self-read, self-write (uid + email immutable). Admins can read all.
The public profile loader (`getPublicProfile` in `src/lib/data/users.ts`)
goes through Admin SDK and only returns the fields the user has flagged
public; it does **not** rely on rules.

**`admin: true` and `editor: true` live on Firebase Auth Custom Claims, NOT here.** See [`admin.md`](admin.md#granting-admin) for why.

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
| `rsvpCount`, `presenterCount`, `waitlistCount` | number | Denormalized counters, updated in transactions |
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
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**: self-read, self-write; admins do everything.

**Transactional counters**: `submitRsvp` (`src/app/actions/rsvps.ts`) maintains `rsvpCount` / `presenterCount` / `waitlistCount` on the parent event doc inside the transaction. Don't update the RSVP doc outside that path or counters drift.

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
| `submittedAt`, `reviewedAt?`, `createdAt`, `updatedAt` | Timestamp | |

**Rules**:
- Public read only if `status == "approved"` (so pending/rejected stay private to owner+admin)
- Owners can create with `status: "pending"`, edit (which flips status back to `pending` for re-review), and delete
- Admins approve/reject (sets `status`, `reviewerUid`, `reviewNote`, `reviewedAt`)

Notification on decision is enqueued via `enqueueProjectDecisionNotification` (no-op until issue #15 lands).

## `posts/{postId}` (Blog)

Community blog entries. Distinct from `guides` (admin/editor curated help docs without comments). Members can submit posts; admins approve before public release, similar to the Showcase project workflow.

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
| `submittedAt`, `reviewedAt?`, `createdAt`, `updatedAt` | Timestamp | |

**Rules**:
- Public reads only when `status == "published"` (drafts/pending/rejected stay visible to the author + admins)
- Authors create with `status in ("draft", "pending")`; admins approve to flip to `published`
- Owner edits can land in `draft` (save without resubmitting) or `pending` (resubmit for review); never directly in published/rejected/archived. `authorUid` and `reviewerUid` are immutable for owners. Admins can change anything
- Comments live in the `comments` subcollection

### `posts/{postId}/comments/{commentId}`

| Field | Type | Notes |
|---|---|---|
| `authorUid`, `authorName` | string | |
| `authorPhotoURL` | string \| null | |
| `body` | string | Length cap (~2000 chars) will be enforced by the comment Server Action in the follow-up PR; rules currently only constrain identity, not size |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**:
- Read: visible if the parent post is `published`, OR caller is the comment author, OR caller is admin
- Create: signed-in user, only on `published` posts, and `authorUid` must match the caller
- Update: author can edit body, but `authorUid` is immutable (no impersonation by edit). Admin can change anything
- Delete: author or admin

UI lands in a follow-up PR.

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

## `guides/{guideId}` (Curated help articles)

Admin- and editor-curated reference docs. Distinct from `qa` (open community) and `posts` (community blog with review queue).

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Unique URL slug |
| `title` | string | |
| `body` | string | Markdown |
| `tags` | string[] | |
| `status` | enum | `"draft" \| "published"` |
| `order` | number | Manual sort key for the `/guide` list; lower = earlier |
| `likeCount` | number? | |
| `createdBy`, `updatedBy` | `{ uid, displayName, email }` | Last editor identity, denormalized |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**: public read on `published`; write restricted to admin + editor.

Comments + likes subcollections behave the same as posts.

## Comment + like subcollections (shared shape)

These collections live under each of `posts`, `guides`, `qa`, and `projects`:

```
{parent}/{parentId}/comments/{commentId}
{parent}/{parentId}/comments/{commentId}/likes/{uid}
{parent}/{parentId}/likes/{uid}
```

The doc shape and rules are identical across parent types; the URL prefix
(post→`/blog`, guide→`/guide`, qa→`/qa`, project→`/showcase`) is derived
via `parentRoutePrefix` in `src/lib/comments-parent.ts`.

### `comments/{commentId}`

| Field | Type | Notes |
|---|---|---|
| `parentType` | `"post" \| "guide" \| "qa" \| "project"` | Denormalized for cross-parent activity feeds |
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

Written by `src/lib/notifications.ts` via the Admin SDK. Once the Firebase Trigger Email extension is installed (issue #15), it watches this collection and sends via the configured SMTP provider.

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
posts/{uid}/...                         blog cover images (author write, public read)
users/{uid}/...                         avatars (self write, public read)
```

All paths are public-read so direct download URLs work without auth. Write rules enforce ownership + max size (10MB events, 50MB presentations, 5MB projects/posts, 2MB avatars). See `storage.rules`.

## Composite indexes

Tracked in `firestore.indexes.json` (deployed by `.github/workflows/deploy-rules.yml`). Add new indexes there when a query throws the "create index" link — copy the spec from the URL Firestore generates.

Current indexes cover:
- `events` queries with status + startAt sort
- `projects` by status + submittedAt
- `posts` by status + submittedAt / publishedAt
- `qa` by status + createdAt
- **`comments` collectionGroup** by `authorUid` + `likeCount` — powers `/my/likes` (PR #46)
- Per-parent comment listing by `createdAt`

If you add a new sort/filter combination, prefer adding it locally + pushing rather than waiting for production to hit the missing-index error.
