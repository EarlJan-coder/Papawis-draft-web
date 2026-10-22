import { sql } from "drizzle-orm";
import { db } from "@/db";
import { APP_TABLES } from "./pg-utils";

/**
 * Application-table reset for integration tests, over the app's own
 * connection (which the vitest config points at the disposable test
 * database). Only ever runs against that database.
 */
export async function resetDatabase(): Promise<void> {
  const list = APP_TABLES.map((t) => `"${t}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE TABLE ${list} CASCADE`));
}
