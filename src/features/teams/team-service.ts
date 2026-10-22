import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, draftTeamAssignments, teams } from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";

/**
 * League team management (Phase 4).
 *
 * Teams are league-level: this MVP league has exactly four. Captain
 * assignments and draft order live in `draft_team_assignments` (per draft),
 * not on the team row. A team referenced by any draft assignment cannot be
 * deleted — the FK cascade would silently destroy assignments and picks.
 * Every mutation is organizer-only and audited.
 */

export const MAX_TEAMS = 4;
const MAX_NAME_LENGTH = 40;

export type TeamMutationResult =
  | { ok: true; team: typeof teams.$inferSelect }
  | {
      ok: false;
      error:
        | "forbidden"
        | "not-found"
        | "team-limit"
        | "duplicate-name"
        | "invalid-name"
        | "team-in-use";
      message: string;
    };

/** All league teams, oldest first. */
export async function listTeams(): Promise<typeof teams.$inferSelect[]> {
  return db.select().from(teams).orderBy(asc(teams.createdAt));
}

export async function createTeam(
  actor: Actor,
  rawName: string,
): Promise<TeamMutationResult> {
  if (actor.role !== "organizer") return forbidden();

  const name = normalizeName(rawName);
  if (!name || name.length > MAX_NAME_LENGTH) {
    return {
      ok: false,
      error: "invalid-name",
      message:
        "Team name cannot be empty and must be at most 40 characters.",
    };
  }

  const existing = await db
    .select({ id: teams.id })
    .from(teams)
    .where(sql`lower(${teams.name}) = lower(${name})`)
    .limit(1);
  if (existing.length > 0) {
    return {
      ok: false,
      error: "duplicate-name",
      message: "A team with that name already exists.",
    };
  }

  const count = await db.select({ id: teams.id }).from(teams);
  if (count.length >= MAX_TEAMS) {
    return {
      ok: false,
      error: "team-limit",
      message: `This league already has ${MAX_TEAMS} teams.`,
    };
  }

  const [team] = await db.insert(teams).values({ name }).returning();

  await writeTeamAudit(actor.id, "team.created", team!.id, { name });

  return { ok: true, team: team! };
}

export async function renameTeam(
  actor: Actor,
  teamId: string,
  rawName: string,
): Promise<TeamMutationResult> {
  if (actor.role !== "organizer") return forbidden();

  const name = normalizeName(rawName);
  if (!name) {
    return {
      ok: false,
      error: "invalid-name",
      message: "Team name cannot be empty.",
    };
  }

  const current = await findTeam(teamId);
  if (!current) return notFound();

  const clash = await db
    .select({ id: teams.id })
    .from(teams)
    .where(
      sql`lower(${teams.name}) = lower(${name}) AND ${teams.id} <> ${teamId}`,
    )
    .limit(1);
  if (clash.length > 0) {
    return {
      ok: false,
      error: "duplicate-name",
      message: "A team with that name already exists.",
    };
  }

  const [team] = await db
    .update(teams)
    .set({ name })
    .where(eq(teams.id, teamId))
    .returning();

  await writeTeamAudit(actor.id, "team.renamed", teamId, {
    from: current.name,
    to: name,
  });

  return { ok: true, team: team! };
}

export async function deleteTeam(
  actor: Actor,
  teamId: string,
): Promise<TeamMutationResult> {
  if (actor.role !== "organizer") return forbidden();

  const current = await findTeam(teamId);
  if (!current) return notFound();

  const assignments = await db
    .select({ id: draftTeamAssignments.id })
    .from(draftTeamAssignments)
    .where(eq(draftTeamAssignments.teamId, teamId))
    .limit(1);
  if (assignments.length > 0) {
    return {
      ok: false,
      error: "team-in-use",
      message:
        "This team is part of a draft and cannot be deleted. Remove it from the draft first.",
    };
  }

  await db.delete(teams).where(eq(teams.id, teamId));

  await writeTeamAudit(actor.id, "team.deleted", teamId, {
    name: current.name,
  });

  return { ok: true, team: current };
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

async function findTeam(teamId: string) {
  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return team;
}

function forbidden(): TeamMutationResult {
  return {
    ok: false,
    error: "forbidden",
    message: "You do not have permission to perform this action.",
  };
}

function notFound(): TeamMutationResult {
  return {
    ok: false,
    error: "not-found",
    message: "No team found with that id.",
  };
}

async function writeTeamAudit(
  actorId: string,
  action: string,
  teamId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: actorId,
    action,
    entityType: "team",
    entityId: teamId,
    metadata,
  });
}
