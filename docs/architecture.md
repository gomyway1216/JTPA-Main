# Architecture

How the pieces fit together. Read this once before opening unfamiliar parts of the codebase.

## One-paragraph version

A Next.js 16 App Router app on Firebase App Hosting (Cloud Run). All Firestore reads/writes happen **server-side via the Admin SDK** — Server Components for reads, Server Actions for mutations. The browser only talks to Firebase Auth (for Google sign-in) and Firebase Storage (for direct file uploads). Authorization is enforced in code via `requireUser()` / `requireAdmin()` at every Server Action entry point; Firestore + Storage rules are defense-in-depth, not the primary gate.

## Request lifecycle

```
Browser
  │  signInWithPopup (Firebase Auth Web SDK)
  ↓
Google OAuth → idToken
  │
  │  POST signInWithIdToken(idToken)   ← Server Action
  ↓
Next.js Server (Cloud Run)
  ├── adminAuth().verifyIdToken          (validate)
  ├── adminAuth().createSessionCookie    (5-day cookie, HttpOnly)
  └── adminDb().collection("users").doc(uid).set(...)   (bootstrap profile)
  ↓
Set-Cookie: __session=<signed by Firebase>
  ↓
Browser holds the session cookie. Every subsequent request:
  │
  ↓
Next.js Server
  ├── cookies().get("__session")
  ├── adminAuth().verifySessionCookie(checkRevoked=true)
  └── { uid, email, isAdmin: claim.admin === true }    ← cached per request (React.cache)
```

`getSessionUser()` / `requireUser()` / `requireAdmin()` all live in `src/lib/auth/session.ts`.

## Why Admin SDK only

`src/lib/firebase/client.ts` exports `clientDb = getFirestore(app)` but **no app code calls it**. All Firestore traffic goes through `adminDb()`:

- Server Components call `lib/data/*.ts` loaders (which use `adminDb()`)
- Server Actions in `app/actions/*.ts` use `adminDb()` directly

Benefits:
- Service-account credentials never reach the browser
- One authorization model (the `requireUser` / `requireAdmin` checks) instead of duplicating logic between code and rules
- Server-rendered HTML includes the data — no client-side waterfall
- Realtime subscriptions (`onSnapshot`) aren't currently needed; if they ever are, `clientDb` is already set up

Trade-off: every read goes through Cloud Run. With `dynamic = "force-dynamic"` on most pages, request fan-out is by hand. So far that's fine — the app is small.

## Server → Client component boundary

The Admin SDK returns Firestore `Timestamp` class instances. React rejects class instances at the Server → Client boundary ("Only plain objects can be passed to Client Components"). Two helpers handle this:

- `src/lib/data/serialize.ts` exports `plainify<T>(data)` which does a `JSON.parse(JSON.stringify(data))`. After serialization, Timestamps become `{ _seconds, _nanoseconds }` objects.
- `src/lib/utils.ts` exports `toDate(value: TsLike)` which handles every shape the timestamp might have (Date, Timestamp, `{seconds, nanoseconds}`, `{_seconds, _nanoseconds}`) and returns a JS `Date`.

Every data loader (`lib/data/events.ts`, `lib/data/rsvps.ts`, etc.) calls `plainify` before returning. Server Actions that return docs to Client Components do the same (see `submitRsvp` in `actions/rsvps.ts`).

If you add a new loader or Server Action that returns Firestore data, **remember to `plainify`** or you'll hit the generic "Server Components render" error in production.

## Authorization layers

| Layer | Source of truth | Enforced where |
|---|---|---|
| Identity | Firebase Auth (Google OAuth) | `adminAuth().verifySessionCookie` |
| Admin flag | Firebase Auth **Custom Claim** `admin: true` | `decoded.admin === true` in `session.ts` |
| Action gate | `requireUser()` / `requireAdmin()` thrown errors | Top of every Server Action |
| DB read | `firestore.rules` (defense-in-depth; Admin SDK bypasses) | Cloud-side, irrelevant for app code |
| Storage write | `storage.rules` (path-based + admin claim) | Cloud-side, ENFORCED because uploads go direct |

Admin is set via `scripts/set-admin.mjs <email>`. The script calls `auth.setCustomUserClaims(uid, { admin: true })` and the user must re-login before the new claim flows into their session cookie.

## File uploads — the one place client SDK is used

Presentation file uploads (`PresentationSection.tsx`) go **direct from the browser to Firebase Storage** via `uploadBytesResumable`. Cloud Run never proxies the bytes. After the upload completes, the client calls a Server Action with just the `filePath` + `fileUrl` to record metadata in Firestore.

Authorization at upload time:
- Storage rules check `request.auth.uid == uid` in the path `presentations/{eventId}/{uid}/{...}`, so a user can only write into their own presenter folder
- The metadata Server Action then re-checks RSVP role=presenter status=confirmed before accepting the write

If we ever do event cover images (issue #18), they should follow the same pattern.

## Code conventions

- **Server-only imports**: every `lib/data/*` and `lib/firebase/admin.ts` starts with `import "server-only"`. If you import any of these from a Client Component, the build fails.
- **Zod schemas**: every Server Action validates input with Zod. The repo uses a `parseEventInput`-style helper that catches `safeParse` errors and rethrows with readable Japanese field names. Don't `parse()` (throwing version) directly — production strips the error message.
- **`ignoreUndefinedProperties: true`**: set globally on the Admin Firestore instance (`lib/firebase/admin.ts`). Optional fields can come through as `undefined` without breaking Firestore writes.
- **Form components**: Client Components for forms (`"use client"`), Server Component for the page that loads initial data and renders the form. Pass loaded data as props.
- **Slugs**: `slugify` in `lib/utils.ts` falls back to `event-<base36-timestamp>` when the input strips to fewer than 2 chars (handles Japanese-only titles).
- **`force-dynamic`**: most pages set `export const dynamic = "force-dynamic"`. This keeps things simple at the cost of caching. If you need to enable static rendering, ensure no per-request data dependencies.
