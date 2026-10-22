import fs from "node:fs";

/**
 * Shared test-database URL resolution, used by both vitest.config.mts
 * (worker env), tests/setup/global-setup.ts (DB creation + migrations),
 * and the Playwright E2E stack (tests/e2e/*).
 */

/** Load .env into process.env if the file exists; no-op otherwise. */
export function loadDotEnv(): void {
  if (!fs.existsSync(".env")) return;
  // Real environment variables take precedence over .env values.
  process.loadEnvFile(".env");
}

/**
 * A sibling database on the DATABASE_URL server (same host/port, different
 * database name), so a suite can never touch development data.
 */
export function siblingDatabaseUrl(dbName: string): string {
  const dev = process.env.DATABASE_URL?.trim();
  if (!dev) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (or export DATABASE_URL) before running tests.",
    );
  }
  const url = new URL(dev);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Database URL used by the test suite:
 * 1. TEST_DATABASE_URL when set (CI / Neon), otherwise
 * 2. `<DATABASE_URL host>/papawis_test` — a sibling database on the same
 *    server, so tests can never touch development data.
 */
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) return explicit;
  return siblingDatabaseUrl("papawis_test");
}
