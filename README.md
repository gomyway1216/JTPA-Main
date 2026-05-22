# JTPA-Main

Community website for the Japanese Technology Professionals Association (JTPA): event scheduling + RSVP, presenter material sharing, and an AI project showcase with admin moderation.

Built with **Next.js 16** (App Router) on **Firebase App Hosting**, backed by **Firestore**, **Firebase Auth (Google OAuth)** and **Firebase Storage**.

## Quick start

```bash
git clone https://github.com/gomyway1216/JTPA-Main.git
cd JTPA-Main
npm install
cp .env.example .env.local              # then fill in values from Firebase Console
gcloud auth application-default login   # one-time, for server-side Admin SDK
npm run dev
```

Then open <http://localhost:3000>. See [`docs/setup.md`](docs/setup.md) for the full walkthrough.

## Docs

- [`docs/setup.md`](docs/setup.md) — local dev environment, env vars, Admin SDK credentials
- [`docs/architecture.md`](docs/architecture.md) — how the Next.js app, Server Actions, Firestore, Auth and Storage fit together
- [`docs/data-model.md`](docs/data-model.md) — Firestore collections, indexes, and security rules
- [`docs/admin.md`](docs/admin.md) — admin operations (granting admin, event lifecycle, project review, attendee export)
- [`docs/deployment.md`](docs/deployment.md) — App Hosting auto-deploy, rules CI, env var sources

## Tech stack

| Layer | What |
|---|---|
| Runtime | Next.js 16 App Router on Firebase App Hosting (Cloud Run, us-central1) |
| Data | Firestore (us-west1), Firebase Auth, Firebase Storage |
| Server | React Server Components + Server Actions, Firebase Admin SDK via ADC |
| Client | React 19, Tailwind, Firebase Web SDK (Auth + Storage only) |
| CI | GitHub Actions: lint+build on PR, auto-deploy firestore/storage rules on main |

## Repo layout

```
src/
├── app/             Next.js App Router pages, Server Actions, route segments
│   ├── actions/     "use server" entry points (events, rsvps, projects, auth, presentations)
│   ├── admin/       Admin-only pages (gated by requireAdmin)
│   ├── events/      Public event list + detail (with RSVP + presentation upload)
│   ├── showcase/    Public AI project gallery
│   ├── my/          Per-user dashboards (RSVPs, projects)
│   └── projects/    Project submission flow
├── lib/
│   ├── auth/        Session cookie + requireUser/requireAdmin helpers
│   ├── data/        Firestore read paths (admin SDK), with plainify for SC→CC handoff
│   ├── firebase/    Admin + client SDK initialization
│   └── notifications.ts  Trigger Email enqueueing
└── components/      Shared UI

firestore.rules     Public-readable events, owner-only RSVPs, admin-only mutations
storage.rules       Per-presenter upload paths, public-readable assets
.github/workflows/  ci.yml (PR lint+build), deploy-rules.yml (main → rules deploy)
```

## Contributing

Branch + PR workflow (see [`docs/architecture.md`](docs/architecture.md) for code conventions):

1. `git checkout -b feature/<short-name>` off `main`
2. Make changes, run `npm run typecheck` and `npm run lint` locally
3. `git push -u origin <branch>` then `gh pr create`
4. Wait for CI green, merge via the GitHub UI
5. App Hosting auto-deploys on merge to `main` (~2-3 min build)

Never push directly to `main`.
