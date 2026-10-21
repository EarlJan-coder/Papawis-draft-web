import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Base user table.
 *
 * Phase 2 extends this with Better Auth session/account tables and the full
 * league schema; only the identity foundation exists in Phase 1.
 */
export const userRoleEnum = pgEnum("user_role", ["player", "captain", "organizer"]);

export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: userRoleEnum("role").notNull().default("player"),
  status: userStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
