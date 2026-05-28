# Deployment

Everything that moves code or rules into production.

## Hosting: Firebase App Hosting

The app runs on **Firebase App Hosting** (Cloud Run under the hood) in `us-central1`. The backend is named `jtpa-main`.

- Live URL: <https://bayarea-ai.com> (apex; also reachable at the App Hosting default `https://jtpa-main--jtpa-main.us-central1.hosted.app`)
- Console: <https://console.firebase.google.com/u/0/project/jtpa-main/apphosting/backends/jtpa-main/locations/us-central1/overview>
- Rollouts: <https://console.firebase.google.com/u/0/project/jtpa-main/apphosting/backends/jtpa-main/locations/us-central1/rollouts>

### Auto-deploy on `main` push

App Hosting is wired to this GitHub repo via Developer Connect. Every push to `main` (i.e. every merged PR) triggers:

1. `git clone` of the merged commit
2. `npm ci`
3. `npm run build` (Next.js build with Turbopack)
4. Container image built and pushed to Artifact Registry
5. Cloud Run revision created and traffic rolled to 100%

Total time: ~2-3 minutes per rollout.

Watch progress on the **Rollouts** page above. When the chip flips from "In progress" to "Current", the new revision is live.

### Manual rollback

If a release breaks production:

1. Open the Rollouts page
2. Find a healthy previous build
3. Click ⋮ → **Roll back**

Cloud Run keeps the previous image, so this is near-instant. Then revert the offending PR with `gh pr revert` and the next push redeploys cleanly.

## Environment variables

Three sources, in order of precedence at runtime:

| Source | Used for | Visibility |
|---|---|---|
| `apphosting.yaml` `env:` | Static config (currently none beyond comments) | Checked into git |
| App Hosting Console UI → Environment variables | `NEXT_PUBLIC_FIREBASE_*`, `ADMIN_NOTIFICATION_EMAILS` | Not in git |
| Google Secret Manager (`secret:` ref in `apphosting.yaml`) | True secrets — currently NONE used by app code | Not in git, IAM-gated |

The `NEXT_PUBLIC_FIREBASE_*` values used to be in `apphosting.yaml` but were moved to the Console UI in PR #5 to keep the repo source-code free of identifiers (even though they end up in the client bundle anyway). This is a soft hardening — adjust if it ever gets in the way.

To change a value in the Console UI:

1. Open Console → App Hosting → backends → jtpa-main → Settings → Environment variables
2. Edit
3. The next deploy picks up the new value. Existing revision stays on the old value.

## Firestore + Storage rules

Deploy is wired via GitHub Actions (`.github/workflows/deploy-rules.yml`):

- Trigger: push to `main` that touches `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase.json`, or the workflow file itself
- Uses `google-github-actions/auth@v2` with the `FIREBASE_SERVICE_ACCOUNT` repo secret
- Calls `firebase deploy --only firestore,storage --project jtpa-main` (deploys both rules and indexes; the CLI no-ops anything that hasn't changed)

The service account behind that secret is `gh-actions-rules-deployer@jtpa-main.iam.gserviceaccount.com`, with the `Firebase Admin` + `Service Usage Consumer` roles. (See setup history in the closed PRs for context.)

To manually deploy rules from a laptop (rare):

```bash
firebase use jtpa-main
firebase deploy --only firestore:rules,storage:rules
```

## CI (lint + build) on PRs

`.github/workflows/ci.yml` runs on every PR:

- `npm ci`
- `npm run lint` (ESLint)
- `npm test` (Vitest)
- `npm run build` (Next.js production build, with placeholder `NEXT_PUBLIC_FIREBASE_*` env vars so the build doesn't fail on missing client config)

Type checking isn't a separate CI step — `next build` runs the TypeScript compiler internally, so type errors still fail the build. If you want a faster local check, `npm run typecheck` runs `tsc --noEmit` standalone.

Required status check before merging to `main`.

## Authorized domains (Firebase Auth)

Google sign-in only works from domains explicitly whitelisted in Firebase Auth:

- Console → Authentication → Settings → Authorized domains
- Currently allowed: `localhost`, `jtpa-main.firebaseapp.com`, `jtpa-main.web.app`, `jtpa-main--jtpa-main.us-central1.hosted.app`, `bayarea-ai.com`

If we add another custom domain, add it here too or sign-in will throw `auth/unauthorized-domain`. The matching change is also needed on the GCP API key referrer allow-list (`NEXT_PUBLIC_FIREBASE_API_KEY` in **APIs & Services → Credentials**) — Firebase Auth verifies the API key with its own referrer check, so a domain missing from there throws `auth/api-key-not-valid` even when the Authorized-domains list is right.

## Things to wire up that aren't done yet

| Thing | Tracking issue |
|---|---|
| Trigger Email extension + SMTP provider | [#15](https://github.com/gomyway1216/JTPA-Main/issues/15) |
| `ADMIN_NOTIFICATION_EMAILS` env var (depends on #15) | #15 |

## Cost model

- App Hosting: scales to zero (`minInstances: 0` in `apphosting.yaml`), so idle = $0
- Firestore: free tier covers JTPA's expected traffic (well under 50k reads/day)
- Storage: 5GB free; presentation files at 50MB each give ~100 events of headroom
- Egress + per-request charges: negligible at current scale

Budget alert is set to $10/mo on the Firebase project — bumped only if Trigger Email + Cloud Functions get added.
