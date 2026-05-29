# JTPA-Main

Community website for the Japanese Technology Professionals Association (JTPA): event scheduling + RSVP + QR check-in, presenter material sharing, an AI project showcase (admin-moderated), member blog (admin-moderated), open Q&A, multi-select community polls, and community-written help guides (admin-reviewed first time, then the author is auto-promoted to a `contributor` tier and can self-publish). All content collections support per-record likes and threaded comments from signed-in members.

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
- [`docs/features.md`](docs/features.md) — feature inventory: URL → data → action map across public / member / admin surfaces
- [`docs/admin.md`](docs/admin.md) — admin operations (granting roles, event lifecycle, project/post review, attendee export, About edit)
- [`docs/deployment.md`](docs/deployment.md) — App Hosting auto-deploy, rules CI, env var sources

User-facing help (Japanese) lives in-app at `/help`; admin operational help (Japanese) at `/admin/help`. These are maintained separately from `docs/` — the in-app pages are hand-written JSX optimized for site visitors, while `docs/` targets contributors.

## Tech stack

| Layer | What |
|---|---|
| Runtime | Next.js 16 App Router on Firebase App Hosting (Cloud Run, us-central1) |
| Data | Firestore (us-west1), Firebase Auth, Firebase Storage |
| Server | React Server Components + Server Actions, Firebase Admin SDK via ADC |
| Client | React 19, Tailwind, Firebase Web SDK (Auth + Storage only) |
| CI | GitHub Actions: lint+test+build on PR, auto-deploy firestore/storage rules+indexes on main |

## Repo layout

```
src/
├── app/             Next.js App Router pages, Server Actions, route segments
│   ├── actions/     "use server" entry points (auth, check-in, comments, events, guides, likes,
│   │                poll, posts, presentations, projects, qa, roles, rsvps, site-pages, users)
│   ├── admin/       Admin-only pages (gated by requireAdmin / requireEditor at action level)
│   ├── events/      Public event list + detail (with RSVP + presentation upload + /[slug]/checkin)
│   ├── showcase/    Public AI project gallery
│   ├── projects/    Project submission flow
│   ├── blog/        Member blog (list + detail + comments + submit)
│   ├── posts/       Blog redirects (legacy /posts → /blog)
│   ├── guide/       Help articles (list + detail + comments)
│   ├── qa/          Community Q&A (list + detail + comments + submit)
│   ├── poll/        Multi-select community polls (list + detail + vote + submit)
│   ├── about/       Editable About page (sitePages/about)
│   ├── help/        User-facing help (Japanese)
│   ├── u/           Public user profiles
│   ├── login/       Sign-in
│   └── my/          Per-user dashboards (RSVPs, projects, posts, qa, polls, likes, profile)
├── lib/
│   ├── auth/        Session cookie + requireUser / requireEditor / requireAdmin helpers
│   ├── check-in.ts  Check-in token generator + validity window
│   ├── data/        Firestore read paths (admin SDK), with plainify for SC→CC handoff
│   ├── firebase/    Admin + client SDK initialization
│   └── notifications.ts  Trigger Email enqueueing
└── components/      Shared UI

firestore.rules         Per-collection read/write rules (owner + role gates; comments + likes + check-in patterns)
firestore.indexes.json  Composite indexes (events, projects, posts, guides, qa, polls, rsvps, comments)
storage.rules           Per-uploader paths with image-only + size caps
.github/workflows/      ci.yml (PR lint+test+build), deploy-rules.yml (main → rules + indexes deploy)
```

## Contributing

Branch + PR workflow (see [`docs/architecture.md`](docs/architecture.md) for code conventions):

1. `git checkout -b feature/<short-name>` off `main`
2. Make changes, run `npm run typecheck`, `npm run lint`, and `npm test` locally
3. `git push -u origin <branch>` then `gh pr create`
4. Wait for CI green, merge via the GitHub UI
5. App Hosting auto-deploys on merge to `main` (~2-3 min build)

Never push directly to `main`.
