import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import {
  loadDotEnv,
  resolveTestDatabaseUrl,
} from "./test-db-url";

function pgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

async function ensureDatabaseExists(connectionString: string): Promise<void> {
  // Probe: does the test database already exist?
  const probe = new Client({ connectionString });
  try {
    await probe.connect();
    await probe.query("SELECT 1");
    return;
  } catch (err) {
    if (pgErrorCode(err) !== "3D000") throw err; // 3D000 = db does not exist
  } finally {
    await probe.end().catch(() => undefined);
  }

  const url = new URL(connectionString);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!dbName) throw new Error("Test database URL has no database name.");

  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(
      `CREATE DATABASE "${dbName.replace(/"/g, '""')}"`,
    );
  } catch (err) {
    if (pgErrorCode(err) !== "42P04") throw err; // 42P04 = already exists
  } finally {
    await admin.end().catch(() => undefined);
  }
}

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
