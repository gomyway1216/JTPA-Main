# Local development setup

This walks through getting JTPA-Main running on your laptop. Assumes you've already been added as a member to the `jtpa-main` Firebase project (ask Yudai if not).

## Prerequisites

- Node.js 20+ and `npm`
- `gcloud` CLI ([install guide](https://cloud.google.com/sdk/docs/install))
- A Google account that's a member of the `jtpa-main` Firebase project (with at least the Editor role on Firestore + Auth)

## 1. Clone and install

```bash
git clone https://github.com/gomyway1216/JTPA-Main.git
cd JTPA-Main
npm install
```

## 2. Set up environment variables

```bash
cp .env.example .env.local
```

The `NEXT_PUBLIC_FIREBASE_*` values are project identifiers — they're meant to be exposed to the browser (they end up in the client bundle anyway). The API key is restricted to a specific list of HTTP referrers in GCP Console, so exposing it isn't a credential leak.

Get them yourself from the Firebase Console:

1. Open <https://console.firebase.google.com/u/0/project/jtpa-main/settings/general>
2. Scroll to **マイアプリ → Web app**
3. Click **SDK の設定と構成 → 構成**
4. Copy each field into `.env.local`

You should **not** need to ask anyone to send you secrets.

## 3. Server-side credentials via Application Default Credentials

The app uses the Firebase **Admin SDK** for all Firestore reads/writes from Server Actions and data loaders. Locally, the Admin SDK reads credentials from Application Default Credentials (ADC).

```bash
gcloud auth application-default login
```

This pops a browser window. Log in with the Google account that's already a member of the `jtpa-main` Firebase project. Credentials get saved under `~/.config/gcloud/application_default_credentials.json` and the Admin SDK picks them up automatically.

You don't need a service-account JSON key. (See [`docs/architecture.md`](architecture.md#authentication-layers) for why.)

## 4. Run the dev server

```bash
npm run dev
```

Opens on <http://localhost:3000>. Server Components hit production Firestore — be aware that anything you write locally lands in the real DB.

If you want isolation, see the emulator note below.

## 5. (Optional) Use Firebase emulators

Add to `.env.local`:

```
NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true
```

Then run the emulators in a separate terminal:

```bash
firebase emulators:start --only auth,firestore,storage
```

The client SDK in `src/lib/firebase/client.ts` auto-detects this flag and connects to the emulators. Note that the Admin SDK on the server-side does NOT respect this flag — there's currently no emulator wiring for `adminDb()`. Reads/writes will still hit production. (Issue welcome if this becomes a real need.)

## 6. Grant yourself admin (only if you need to test admin features)

The first admin (Yudai) was set via the script below. To add yourself as a co-admin for testing:

```bash
node scripts/set-admin.mjs your-email@example.com
```

The script needs ADC (step 3) and the same `FIREBASE_PROJECT_ID` env var. After it runs, **sign out of the app and back in** to refresh your session token with the new claim.

To revoke later:

```bash
node scripts/set-admin.mjs your-email@example.com --revoke
```

## Common commands

```bash
npm run dev         # next dev (Turbopack)
npm run build       # next build (used by CI and App Hosting)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Could not load the default credentials` on a Server Action | `gcloud auth application-default login` not run, or the saved creds expired. Re-run it. |
| `auth/unauthorized-domain` on Google sign-in | Add `localhost` to Firebase Auth Authorized Domains (Console → Authentication → Settings) — it should already be there for `localhost` |
| "Cannot use 'undefined' as a Firestore value" | The Admin SDK now ignores undefined fields globally (`src/lib/firebase/admin.ts`). If you still see this, you're probably writing a `null` for an object field somewhere else. |
| Server Components render error in prod with no message | Next.js strips Server Action error messages in production builds. Reproduce locally with `npm run build && npm start` to see the real stack. |
