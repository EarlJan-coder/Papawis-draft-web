# Papawis Draft Web

Basketball league registration and 4-team snake draft platform. Players register and build profiles, the organizer approves eligibility and configures four teams with captains, and captains draft players in snake order. Built with Next.js (App Router), TypeScript, PostgreSQL, Drizzle ORM, and Better Auth.

## Requirements

- Node.js 22+
- PostgreSQL 16 (Docker Compose provided, or a Neon database)

## Getting started

```bash
npm install
cp .env.example .env        # then edit DATABASE_URL
npm run db:migrate          # applies migrations
npm run dev                 # http://localhost:3000
```

### Database options

| Environment | Connection string |
|---|---|
| Local Docker | `postgres://papawis:papawis@localhost:5433/papawis` (`docker compose up -d`) |
| Neon (dev/prod) | `postgres://<user>:<password>@<endpoint>.neon.tech/neondb?sslmode=require` |
| Tests | `TEST_DATABASE_URL` → disposable Postgres (falls back to a sibling DB on the `DATABASE_URL` server) |

> The Docker container publishes host port **5433** to avoid clashing with any
> native PostgreSQL service already on 5432.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Vitest (unit + integration) |
| `npm run e2e` | Playwright end-to-end (full 12-step workflow) |
| `npm run db:generate` | Generate migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Drizzle Studio (browse data) |

## Environment variables

See `.env.example`. Required:

- `DATABASE_URL` — PostgreSQL connection string
- `BETTER_AUTH_SECRET` — `npx @better-auth/cli secret`
- `BETTER_AUTH_URL` — public URL of the app

## Production deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for env vars, Neon setup,
Vercel deploy, the migration procedure, and the post-deploy checklist.

## Project structure

See `PLAN.md` for the phase-by-phase implementation checklist and architecture conventions.

```text
src/
├── app/          # App Router pages + API route handlers
├── components/   # UI and feature components
├── db/           # Drizzle schema, client, migrations
├── lib/          # auth, permissions, validation
├── features/     # business logic services (players, teams, drafts, audit)
└── types/
```
