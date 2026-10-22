import { Client } from "pg";

/**
 * Alias-free Postgres utilities shared by the vitest global setup and the
 * Playwright E2E prepare script. Nothing here may import "@/…" — these run
 * under plain tsx / Playwright, not the vitest alias resolver.
 */

export function pgErrorCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return undefined;
}

/** Create the target database if it does not exist yet (idempotent). */
export async function ensureDatabaseExists(
  connectionString: string,
): Promise<void> {
  // Probe: does the database already exist?
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
  if (!dbName) throw new Error("Database URL has no database name.");

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
 * Application tables (everything except Drizzle's migration journal).
 * TRUNCATE ... CASCADE handles FK ordering in one statement.
 */
export const APP_TABLES = [
  "audit_logs",
  "draft_picks",
  "draft_team_assignments",
  "drafts",
  "player_profiles",
  "teams",
  "sessions",
  "accounts",
  "verifications",
  "rate_limit",
  "users",
] as const;

/** Truncate every application table on the given connection string. */
export async function resetAppTables(
  connectionString: string,
): Promise<void> {
  const list = APP_TABLES.map((t) => `"${t}"`).join(", ");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`TRUNCATE TABLE ${list} CASCADE`);
  } finally {
    await client.end().catch(() => undefined);
  }
}
