import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadDotEnv, siblingDatabaseUrl } from "../setup/test-db-url";
import { ensureDatabaseExists, resetAppTables } from "../setup/pg-utils";

/**
 * E2E database preparation, run by `npm run e2e:server` before `next dev`
 * boots: creates the disposable `papawis_e2e` sibling database if missing,
 * wipes it from the previous run, and applies all migrations. Alias-free on
 * purpose — this runs under plain tsx, not the vitest resolver.
 */
async function main(): Promise<void> {
  loadDotEnv();
  const e2eUrl = siblingDatabaseUrl("papawis_e2e");

  await ensureDatabaseExists(e2eUrl);

  const pool = new Pool({ connectionString: e2eUrl });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(process.cwd(), "src/db/migrations"),
    });
  } finally {
    await pool.end();
  }

  // Migrations first (a fresh database has no tables yet), then wipe the
  // previous run's rows so every E2E run starts from zero.
  await resetAppTables(e2eUrl);

  // Never log the connection string (it contains credentials).
  console.log("E2E database ready: papawis_e2e");
}

main().catch((err) => {
  console.error("E2E database preparation failed:", err);
  process.exit(1);
});
