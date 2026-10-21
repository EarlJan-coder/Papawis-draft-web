import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Teams are league-level entities. Their captain assignments and draft order
 * live in `draft_team_assignments` (per-draft), not on the team row itself.
 */
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
