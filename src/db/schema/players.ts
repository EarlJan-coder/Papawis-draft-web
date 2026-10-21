import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const profileStatusEnum = pgEnum("profile_status", [
  "pending",
  "approved",
  "rejected",
]);

export const skillLevelEnum = pgEnum("skill_level", [
  "beginner",
  "intermediate",
  "advanced",
  "elite",
]);

export const BASKETBALL_POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;

export const playerProfiles = pgTable(
  "player_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    photoUrl: text("photo_url"),
    dateOfBirth: date("date_of_birth"),
    heightCm: integer("height_cm"),
    positions: text("positions").array().notNull(),
    skillLevel: skillLevelEnum("skill_level"),
    experience: text("experience"),
    bio: text("bio"),
    profileStatus: profileStatusEnum("profile_status")
      .notNull()
      .default("pending"),
    statusReason: text("status_reason"),
    isDraftEligible: boolean("is_draft_eligible").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      "player_profiles_positions_valid",
      sql`${t.positions} <@ ARRAY['PG','SG','SF','PF','C']::text[]`,
    ),
    check(
      "player_profiles_height_range",
      sql`${t.heightCm} IS NULL OR (${t.heightCm} BETWEEN 100 AND 260)`,
    ),
  ],
);

export const playerProfilesRelations = relations(
  playerProfiles,
  ({ one }) => ({
    user: one(users, {
      fields: [playerProfiles.userId],
      references: [users.id],
    }),
  }),
);
