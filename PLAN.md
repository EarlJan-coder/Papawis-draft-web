# Implementation Plan — Papawis Basketball League Draft Platform

Basketball league registration + 4-team snake draft MVP. One league, three roles (player, captain, organizer).

## Conventions

- Each phase lives on its own branch: `phase/1-foundation`, `phase/2-db-auth`, ... pushed to GitHub and merged to `main` on exit.
- TypeScript strict; server is source of truth; all mutations validated + authorized server-side.
- Design: monochromatic purple anchored on `#7749b6`.
- Local dev DB: Docker Postgres. User's dev DB: Neon (`DATABASE_URL`). Tests use `TEST_DATABASE_URL` (real Postgres).

## Phase 1 — Repository inspection & foundation ✅

- [x] Inspect repo (greenfield; GitHub remote `EarlJan-coder/Papawis-draft-web`)
- [x] Scaffold Next.js 16 (App Router, TS strict, Tailwind, src/)
- [x] Install core deps: drizzle-orm, drizzle-kit, better-auth, zod, vitest, playwright, pg proxy deps
- [x] Docker Compose Postgres for local dev
- [x] Drizzle config + minimal migration pipeline
- [x] Purple design tokens (`#7749b6` monochromatic) + base UI primitives
- [x] .env.example, README setup docs
- [x] Verify: `tsc --noEmit` passes, `next build` succeeds, migration applies to clean DB

## Phase 2 — Database & authentication

- [x] Full schema: users (role enum), player_profiles, teams, drafts, draft_team_assignments, draft_picks, audit_logs + Better Auth tables
- [x] Constraints: unique active pick per draft, unique (draft, pick_number), unique captain/draft-order per draft
- [x] Better Auth: register/login/logout, DB sessions, protected route groups
- [x] Centralized `requireUser` / `requireRole` guards
- [x] Organizer provisioning script (env bootstrap; never via web)
- [x] Tests: auth guards, role escalation prevention

## Phase 3 — Player registration & organizer approval

- [x] Profile form (display name, DOB, height cm, positions PG/SG/SF/PF/C, skill, experience, bio)
- [x] Server-side Zod validation; age computed from DOB; no full DOB/email exposure
- [x] Profile completion + status display on player dashboard
- [x] Organizer review queue: approve/reject with reason, eligibility toggle
- [x] Tests: profile validation, approval rules, self-approval prevention

## Phase 4 — Teams & draft setup

- [x] Team CRUD (exactly 4), captain assignment (unique per draft), draft order
- [x] Draft creation + lifecycle transitions (setup → active → paused → completed) with validation
- [x] Start-readiness validation (4 teams, captains, order)
- [x] Tests: state transitions, assignment rules, start validation

## Phase 5 — Draft engine

- [x] Pure snake-order module + tests (picks 1–8, later rounds, 4 teams)
- [x] Transactional pick service (row lock, server-derived turn, eligibility, uniqueness, audit, idempotency key)
- [x] Pause / resume / undo (soft reversal + audit) / complete policies
- [x] Concurrency tests: parallel pick requests → exactly one succeeds
- [x] HTTP layer: 409 on stale turn, safe error responses

## Phase 6 — Draft interface & roster management

- [ ] Draft board: available players (search, position filter), photo placeholder, height/positions/skills
- [ ] Current turn banner, pick confirmation dialog, error/conflict feedback
- [ ] Team roster summaries + position coverage (advisory warnings)
- [ ] Draft history view
- [ ] Captain + organizer dashboards wired to live draft state

## Phase 7 — Audit history & publication

- [ ] Audit log recording across admin + draft actions
- [ ] Organizer audit history UI
- [ ] Draft completion validation + roster publication (server-gated)
- [ ] Public homepage: league name (configurable), published rosters only; no private data leak

## Phase 8 — QA & deployment readiness

- [ ] Playwright E2E: full 12-step workflow (register → approve → teams → draft → pause/undo → publish)
- [ ] Lint, typecheck, unit + integration suites green
- [ ] Security review pass (authz on every endpoint, no secret leakage, rate limiting on auth/draft)
- [ ] Production docs: env vars, Neon setup, Vercel deploy, migration procedure
- [ ] All §9 acceptance criteria verified

## Manual configuration required (user)

- [ ] Neon database → `DATABASE_URL` (dev) and Vercel env (prod)
- [ ] `BETTER_AUTH_SECRET` for production
- [ ] Vercel project creation + deploy
