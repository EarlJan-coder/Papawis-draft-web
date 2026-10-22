import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import {
  loadDotEnv,
  resolveTestDatabaseUrl,
} from "./test-db-url";
import { ensureDatabaseExists } from "./pg-utils";

/**
 * Vitest global setup: create the disposable test database if missing and
 * apply all Drizzle migrations before any test file runs.
 */
export default async function globalSetup(): Promise<void> {
  loadDotEnv();
  const testUrl = resolveTestDatabaseUrl();

  await ensureDatabaseExists(testUrl);

  const pool = new Pool({ connectionString: testUrl });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: path.resolve(process.cwd(), "src/db/migrations"),
    });
  } finally {
    await pool.end();
  }
}
