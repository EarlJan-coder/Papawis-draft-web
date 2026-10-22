# Production deployment

How to run the Papawis Draft Web platform in production: environment
variables, a Neon database, Vercel, and the migration procedure.

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**
(Production and Preview) and in your local `.env` for development.

| Variable | Required | Purpose / notes |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string. Use the **pooled** Neon endpoint in Vercel (see below). Always `?sslmode=require`. |
| `BETTER_AUTH_SECRET` | ✅ | Better Auth signing secret. Generate with `npx @better-auth/cli secret`. **Never** reuse the dev value; rotating it invalidates existing sessions. |
| `BETTER_AUTH_URL` | ✅ | Public URL of the deployed app, e.g. `https://papawis.vercel.app` (no trailing slash). Used for auth redirects and origin checks. |
| `LEAGUE_NAME` | optional | League branding shown on the homepage. Defaults to `Papawis League`. |
| `TEST_DATABASE_URL` | local only | Disposable Postgres for `npm test`. Never set in production. |
| `SEED_ORGANIZER_EMAIL` | one-off | Convenience for `npm run provision:organizer` (below). |

No other secrets exist in the app; `.env*` files are gitignored and must
never be committed.

## Neon setup

1. Create a project at [neon.tech](https://neon.tech) (PostgreSQL 16+).
2. Neon gives you **two connection strings** per project:
   - **Direct** endpoint (`…neon.tech`) — for migrations. `drizzle-kit`
     migrations use session-level features (advisory locks) that the
     pooled endpoint can't reliably provide.
   - **Pooled** endpoint (`…neon.tech/pgbouncer`) — for the app. Serverless
     functions open many short-lived connections; the pooler absorbs them
     instead of exhausting Neon's compute connection limit.
3. Locally, use either endpoint for `DATABASE_URL`, always with
   `?sslmode=require`.

## Vercel deploy

1. Push the repo to GitHub (`EarlJan-coder/Papawis-draft-web`) and import
   it in Vercel — the Next.js framework preset is detected automatically;
   no build overrides are needed (`npm run build` is the standard build).
2. Set the environment variables above **before** the first deploy.
3. Deploy. Verify afterwards (smoke checklist below).

Notes:

- The app holds one lazy Postgres pool per serverless instance
  (`src/db`); no `DATABASE_POOLer`/accelerator is required.
- Migrations are **not** run by Vercel. Apply them yourself with the
  procedure below before (or immediately with) the deploy that needs them.
- The organizer role can never be granted through the web UI. Provision
  the first organizer from your machine against the production database:

  ```bash
  DATABASE_URL="<prod pooled url>" npm run provision:organizer -- <organizer-email>
  ```

  It is idempotent (already-organizer → no-op) and audits the grant.

## Migration procedure

Schema changes are forward-only (drizzle-kit has no `down` migration in
this project).

```bash
# 1. Generate the migration from schema changes (never hand-edit old files)
npm run db:generate

# 2. Review the generated SQL under src/db/migrations/
# 3. Verify it against a disposable/ dev database
DATABASE_URL="<dev url>" npm run db:migrate

# 4. Commit the schema + migration files together with the code that needs them

# 5. Apply to production — run BEFORE deploying code that depends on it,
#    using the DIRECT (unpooled) Neon endpoint:
DATABASE_URL="<prod direct url>" npm run db:migrate

# 6. Deploy the code (Vercel picks up the pushed commit / merge to main)
```

Safety notes:

- `npm run db:migrate` is idempotent — it records applied migrations in
  the `__drizzle_migrations` table and only runs the pending ones.
- Adding nullable columns or new tables is safe while the old code is
  still live (deploy = expand). Prefer expand → migrate → deploy →
  contract for anything destructive (dropped/renamed columns): keep the
  old column readable until the new code is out, then remove it in a
  follow-up migration.
- Because there is no down migration, rollback = revert the code and, if
  the migration itself was bad, restore from the Neon snapshot/backup and
  re-apply a corrected forward migration.

## Post-deploy smoke checklist

- [ ] `https://<your-domain>/` renders the homepage (200) and shows the
      "Final rosters" pending state.
- [ ] Response headers include `Content-Security-Policy`,
      `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
- [ ] Register a throwaway account, log out, log back in.
- [ ] `npm run provision:organizer -- <your-email>` succeeds and the
      organizer console (`/organizer`) is reachable.
- [ ] No 5xx in Vercel logs; auth 429s only appear under abuse (the
      sign-up/sign-in budget is 15 requests/minute per IP and path).

## Quality gates (run before every release)

```bash
npm run typecheck     # strict TS
npm run lint          # eslint
npm test              # vitest unit + integration (needs TEST_DATABASE_URL)
npm run e2e           # Playwright full 12-step workflow (needs a reachable local
                      # Postgres — Docker on :5433; it creates and wipes its own
                      # disposable `papawis_e2e` database first)
npm run build         # production build (Cache Components / PPR)
```

Known accepted risk: `npm audit` reports 4 moderate advisories, all in
`drizzle-kit`'s bundled `esbuild` (dev-toolchain only — it never ships in
the Vercel runtime build).
