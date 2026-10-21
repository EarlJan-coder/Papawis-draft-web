import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Better Auth database rate-limit storage (storage: "database").
 *
 * - `id` exists because Better Auth's schema validator expects an id column
 *   on every model; Better Auth never writes it, so the database generates it.
 * - `lastRequest` is a bigint: it stores Date.now() (epoch ms), which
 *   overflows a 4-byte integer.
 * Rows are upserted/trimmed by Better Auth itself.
 */
export const rateLimits = pgTable(
  "rate_limit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [index("rate_limit_last_request_idx").on(t.lastRequest)],
);
