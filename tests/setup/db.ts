import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Application tables (everything except Drizzle's migration journal).
 * TRUNCATE ... CASCADE handles FK ordering in one statement.
 * Only ever runs against the disposable test database.
 */
const APP_TABLES = [
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

export async function resetDatabase(): Promise<void> {
  const list = APP_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} CASCADE`));
}
