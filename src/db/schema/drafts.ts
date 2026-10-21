import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { users } from "./auth";
import { playerProfiles } from "./players";

export const draftStatusEnum = pgEnum("draft_status", [
  "setup",
  "active",
  "paused",
  "completed",
]);

export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    status: draftStatusEnum("status").notNull().default("setup"),
    // Authoritative snake-draft cursor: next pick number to be made (1-based).
    currentPickNumber: integer("current_pick_number")
      .notNull()
      .default(1),
    // Number of rounds the organizer configured for this draft (4 teams × rounds = total picks).
    totalRounds: integer("total_rounds").notNull().default(8),
    startedAt: timestamp("started_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("drafts_current_pick_positive", sql`${t.currentPickNumber} >= 1`),
    check("drafts_rounds_positive", sql`${t.totalRounds} >= 1`),
  ],
);

export const draftTeamAssignments = pgTable(
  "draft_team_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    captainUserId: uuid("captain_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    draftOrder: integer("draft_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One row per team per draft.
    uniqueIndex("draft_assignments_draft_team_uq").on(t.draftId, t.teamId),
    // A captain cannot lead two teams in the same draft.
    uniqueIndex("draft_assignments_draft_captain_uq").on(
      t.draftId,
      t.captainUserId,
    ),
    // Draft order is unique within a draft.
    uniqueIndex("draft_assignments_draft_order_uq").on(t.draftId, t.draftOrder),
    check(
      "draft_assignments_order_range",
      sql`${t.draftOrder} BETWEEN 1 AND 4`,
    ),
    index("draft_assignments_draft_idx").on(t.draftId),
  ],
);

export const draftPicks = pgTable(
  "draft_picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    pickNumber: integer("pick_number").notNull(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => playerProfiles.id, { onDelete: "restrict" }),
    pickedByUserId: uuid("picked_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    pickedAt: timestamp("picked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Undo is a soft reversal: the original row is preserved.
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneByUserId: uuid("undone_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    undoReason: text("undo_reason"),
    // Optional client-supplied idempotency key to make network retries safe.
    idempotencyKey: text("idempotency_key"),
  },
  (t) => [
    // A pick number can only be consumed once per draft.
    uniqueIndex("draft_picks_draft_pick_uq").on(t.draftId, t.pickNumber),
    // A player can only hold ONE active pick per draft.
    uniqueIndex("draft_picks_active_player_uq")
      .on(t.draftId, t.playerId)
      .where(sql`${t.undoneAt} IS NULL`),
    // Idempotent retries reuse the same key within the draft.
    uniqueIndex("draft_picks_idempotency_uq")
      .on(t.draftId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("draft_picks_draft_idx").on(t.draftId),
    check("draft_picks_pick_positive", sql`${t.pickNumber} >= 1`),
  ],
);

export const draftsRelations = relations(drafts, ({ many }) => ({
  assignments: many(draftTeamAssignments),
  picks: many(draftPicks),
}));

export const draftTeamAssignmentsRelations = relations(
  draftTeamAssignments,
  ({ one }) => ({
    draft: one(drafts, {
      fields: [draftTeamAssignments.draftId],
      references: [drafts.id],
    }),
    team: one(teams, {
      fields: [draftTeamAssignments.teamId],
      references: [teams.id],
    }),
    captain: one(users, {
      fields: [draftTeamAssignments.captainUserId],
      references: [users.id],
    }),
  }),
);

export const draftPicksRelations = relations(draftPicks, ({ one }) => ({
  draft: one(drafts, {
    fields: [draftPicks.draftId],
    references: [drafts.id],
  }),
  team: one(teams, {
    fields: [draftPicks.teamId],
    references: [teams.id],
  }),
  player: one(playerProfiles, {
    fields: [draftPicks.playerId],
    references: [playerProfiles.id],
  }),
  pickedBy: one(users, {
    fields: [draftPicks.pickedByUserId],
    references: [users.id],
  }),
}));
