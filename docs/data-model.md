# Data model

Firestore collections and the rules that protect them. All field types live in `src/lib/types.ts`.

## Collections at a glance

```
users/{uid}
events/{eventId}
  ├─ rsvps/{uid}
  └─ presentations/{autoId}
projects/{projectId}
posts/{postId}
  └─ comments/{commentId}
mail/{autoId}      ← Trigger Email extension (writes only via Admin SDK)
```

## `users/{uid}`

Bootstrapped on first sign-in by `signInWithIdToken` (`src/app/actions/auth.ts`). Mirrors the Firebase Auth identity plus app-specific fields.

| Field | Type | Notes |
|---|---|---|
| `uid` | string | Same as the doc id, redundant on purpose for collection-group queries |
| `email` | string | From Google OAuth |
| `displayName` | string | From Google OAuth (falls back to email prefix) |
| `photoURL` | string \| null | From Google OAuth |
| `affiliation` | string | Free text. Currently captured per-RSVP; no profile UI yet (issue #16) |
| `emailOptIn` | boolean | Defaults to `true`; no UI to change yet (issue #16) |
| `createdAt`, `updatedAt` | Timestamp | |

**Rules**: self-read, self-write (uid + email immutable). Admins can read all.

**`admin: true` lives on Firebase Auth Custom Claims, NOT here.** See [`admin.md`](admin.md#granting-admin) for why.

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

Currently none beyond the auto-created ones. If you add a query like `.where(...).orderBy(...)`, Firestore will surface a "create index" link in the error message at first call — capture that index spec and check in via `firestore.indexes.json` (not currently present; create when needed).
