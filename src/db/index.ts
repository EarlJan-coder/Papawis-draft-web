import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Lazy PostgreSQL client.
 *
 * The pool is created on first use so that `next build` (which may not have
 * DATABASE_URL available for prerendering) never fails at import time.
 */
declare global {
  var __papawisPool: Pool | undefined;
}

function getPool(): Pool {
  if (!global.__papawisPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not set. Copy .env.example to .env and configure it.",
      );
    }
    global.__papawisPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
    });
  }
  return global.__papawisPool;
}

export const db = drizzle(getPool(), { schema });
export type Database = typeof db;
