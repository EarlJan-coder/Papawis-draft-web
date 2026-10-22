import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  draftTeamAssignments,
  drafts,
  playerProfiles,
  teams,
  users,
} from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";
import { maskEmail } from "@/lib/utils";

/**
 * Draft lifecycle and captain assignment (Phase 4).
 *
 * A draft moves setup → active → (paused ⇄ active) → completed. Every
 * transition is validated here, not in the UI: setup-only mutations freeze
 * once the draft starts, and starting requires a complete configuration
 * (exactly four league teams, four distinct captains, draft order 1–4).
 * Captain candidates must be active, non-organizer users with an approved
 * player profile; assigning one promotes their role to "captain" (roles are
 * never demoted here). All actions are organizer-only and audited.
 */

export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 20;
export const TEAMS_PER_DRAFT = 4;

export type DraftErrorCode =
  | "forbidden"
  | "not-found"
  | "draft-exists"
  | "invalid-state"
  | "invalid-rounds"
  | "not-ready"
  | "captain-not-eligible"
  | "captain-conflict"
  | "order-taken"
  | "invalid-order";

export type DraftResult =
  | { ok: true; draft: typeof drafts.$inferSelect }
  | { ok: false; error: DraftErrorCode; message: string };

export type AssignmentResult =
  | { ok: true; assignment: typeof draftTeamAssignments.$inferSelect }
  | { ok: false; error: DraftErrorCode; message: string };

export type DraftReadiness = {
  ready: boolean;
  missing: string[];
};

// ---------------------------------------------------------------------------
// Creation + lookup
// ---------------------------------------------------------------------------

export async function createDraft(
  actor: Actor,
  options: { totalRounds?: number } = {},
): Promise<DraftResult> {
  if (actor.role !== "organizer") return forbidden();

  const rounds = options.totalRounds ?? 8;
  const roundsError = validateRounds(rounds);
  if (roundsError) return roundsError;

  const current = await getCurrentDraft();
  if (current) {
    return {
      ok: false,
      error: "draft-exists",
      message: "A draft is already in progress. Complete it before creating another.",
    };
  }

  const [draft] = await db
    .insert(drafts)
    .values({ totalRounds: rounds })
    .returning();

  await writeDraftAudit(actor.id, "draft.created", draft!.id, {
    totalRounds: rounds,
  });

  return { ok: true, draft: draft! };
}

/** The league's current (not yet completed) draft, if any. */
export async function getCurrentDraft(): Promise<
  typeof drafts.$inferSelect | null
> {
  const [draft] = await db
    .select()
    .from(drafts)
    .where(ne(drafts.status, "completed"))
    .orderBy(asc(drafts.createdAt))
    .limit(1);
  return draft ?? null;
}

/** The most recent draft of any status (completed drafts still render). */
export async function getLatestDraft(): Promise<
  typeof drafts.$inferSelect | null
> {
  const [draft] = await db
    .select()
    .from(drafts)
    .orderBy(desc(drafts.createdAt))
    .limit(1);
  return draft ?? null;
}

export async function getDraftById(
  draftId: string,
): Promise<typeof drafts.$inferSelect | null> {
  const [draft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.id, draftId))
    .limit(1);
  return draft ?? null;
}

// ---------------------------------------------------------------------------
// Setup-phase configuration
// ---------------------------------------------------------------------------

export async function setDraftRounds(
  actor: Actor,
  draftId: string,
  rounds: number,
): Promise<DraftResult> {
  if (actor.role !== "organizer") return forbidden();

  const draft = await requireDraft(draftId);
  if (!draft) return notFoundDraft();
  if (draft.status !== "setup") return frozenDraft();

  const roundsError = validateRounds(rounds);
  if (roundsError) return roundsError;

  const [updated] = await db
    .update(drafts)
    .set({ totalRounds: rounds })
    .where(eq(drafts.id, draftId))
    .returning();

  await writeDraftAudit(actor.id, "draft.rounds_changed", draftId, {
    totalRounds: rounds,
  });

  return { ok: true, draft: updated! };
}

/**
 * Assign (or replace) a team's captain and draft order. Setup-phase only.
 * Replacing a team's captain re-validates it against the other three.
 */
export async function assignCaptain(
  actor: Actor,
  draftId: string,
  teamId: string,
  captainUserId: string,
  draftOrder: number,
): Promise<AssignmentResult> {
  if (actor.role !== "organizer") return forbiddenAssignment();

  const draft = await requireDraft(draftId);
  if (!draft) return notFoundAssignment("No draft found with that id.");
  if (draft.status !== "setup") {
    return {
      ok: false,
      error: "invalid-state",
      message: "Captains can only be assigned while the draft is in setup.",
    };
  }

  if (
    !Number.isInteger(draftOrder) ||
    draftOrder < 1 ||
    draftOrder > TEAMS_PER_DRAFT
  ) {
    return {
      ok: false,
      error: "invalid-order",
      message: `Draft order must be an integer between 1 and ${TEAMS_PER_DRAFT}.`,
    };
  }

  const [team] = await db
    .select()
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) {
    return notFoundAssignment("No team found with that id.");
  }

  const eligibility = await checkCaptainEligibility(captainUserId);
  if (eligibility !== null) return eligibility;

  // Conflicts are checked against the other assignments in this draft.
  const others = await db
    .select()
    .from(draftTeamAssignments)
    .where(eq(draftTeamAssignments.draftId, draftId));

  const captainClash = others.find(
    (a) => a.captainUserId === captainUserId && a.teamId !== teamId,
  );
  if (captainClash) {
    return {
      ok: false,
      error: "captain-conflict",
      message: "That captain already leads another team in this draft.",
    };
  }
  const orderClash = others.find(
    (a) => a.draftOrder === draftOrder && a.teamId !== teamId,
  );
  if (orderClash) {
    return {
      ok: false,
      error: "order-taken",
      message: `Pick ${draftOrder} is already assigned to another team.`,
    };
  }

  const existing = others.find((a) => a.teamId === teamId);
  const assignment = existing
    ? (
        await db
          .update(draftTeamAssignments)
          .set({ captainUserId, draftOrder })
          .where(eq(draftTeamAssignments.id, existing.id))
          .returning()
      )[0]
    : (
        await db
          .insert(draftTeamAssignments)
          .values({ draftId, teamId, captainUserId, draftOrder })
          .returning()
      )[0];

  // Assignment carries the captain role; guards gate captain surfaces by it.
  await db
    .update(users)
    .set({ role: "captain" })
    .where(and(eq(users.id, captainUserId), eq(users.role, "player")));

  await writeDraftAudit(actor.id, "draft.captain_assigned", draftId, {
    teamId,
    teamName: team.name,
    captainUserId,
    draftOrder,
  });

  return { ok: true, assignment: assignment! };
}

export async function removeAssignment(
  actor: Actor,
  draftId: string,
  teamId: string,
): Promise<AssignmentResult> {
  if (actor.role !== "organizer") return forbiddenAssignment();

  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!team) {
    return notFoundAssignment("No team found with that id.");
  }

  const draft = await requireDraft(draftId);
  if (!draft) return notFoundAssignment("No draft found with that id.");
  if (draft.status !== "setup") {
    return {
      ok: false,
      error: "invalid-state",
      message: "Captains can only be changed while the draft is in setup.",
    };
  }

  const [existing] = await db
    .select()
    .from(draftTeamAssignments)
    .where(
      and(
        eq(draftTeamAssignments.draftId, draftId),
        eq(draftTeamAssignments.teamId, teamId),
      ),
    )
    .limit(1);
  if (!existing) {
    return notFoundAssignment("That team has no assignment in this draft.");
  }

  await db
    .delete(draftTeamAssignments)
    .where(eq(draftTeamAssignments.id, existing.id));

  await writeDraftAudit(actor.id, "draft.captain_removed", draftId, {
    teamId,
    captainUserId: existing.captainUserId,
    draftOrder: existing.draftOrder,
  });

  return { ok: true, assignment: existing };
}

/** Pre-start checklist for the organizer UI. */
export async function getDraftReadiness(draftId: string): Promise<DraftReadiness> {  const draft = await requireDraft(draftId);
  if (!draft) return { ready: false, missing: ["draft-not-found"] };

  const missing: string[] = [];

  const leagueTeams = await db.select({ id: teams.id }).from(teams);
  if (leagueTeams.length !== TEAMS_PER_DRAFT) {
    missing.push("teams");
  }

  const assignments = await db
    .select()
    .from(draftTeamAssignments)
    .where(eq(draftTeamAssignments.draftId, draftId));
  if (assignments.length !== TEAMS_PER_DRAFT) {
    missing.push("captains");
  }

  const orders = new Set(assignments.map((a) => a.draftOrder));
  if (orders.size !== TEAMS_PER_DRAFT) {
    missing.push("draft-order");
  }

  return { ready: missing.length === 0, missing };
}

export type DraftAssignmentSummary = {
  teamId: string;
  teamName: string;
  captainUserId: string | null;
  captainName: string | null;
  draftOrder: number | null;
};

/** Assignments for a draft, in draft order, with captain display names. */
export async function listDraftAssignments(
  draftId: string,
): Promise<DraftAssignmentSummary[]> {
  const rows = await db
    .select({
      teamId: draftTeamAssignments.teamId,
      teamName: teams.name,
      captainUserId: draftTeamAssignments.captainUserId,
      captainName: users.name,
      draftOrder: draftTeamAssignments.draftOrder,
    })
    .from(draftTeamAssignments)
    .innerJoin(teams, eq(draftTeamAssignments.teamId, teams.id))
    .leftJoin(users, eq(draftTeamAssignments.captainUserId, users.id))
    .where(eq(draftTeamAssignments.draftId, draftId))
    .orderBy(asc(draftTeamAssignments.draftOrder));

  return rows.map((r) => ({
    teamId: r.teamId,
    teamName: r.teamName,
    captainUserId: r.captainUserId,
    captainName: r.captainName,
    draftOrder: r.draftOrder,
  }));
}

export type CaptainCandidate = {
  userId: string;
  displayName: string;
  emailMasked: string;
  role: string;
};

/** Users the organizer may assign as captains: active, approved profile. */
export async function listCaptainCandidates(): Promise<CaptainCandidate[]> {
  const rows = await db
    .select({
      userId: users.id,
      role: users.role,
      email: users.email,
      displayName: playerProfiles.displayName,
    })
    .from(playerProfiles)
    .innerJoin(users, eq(playerProfiles.userId, users.id))
    .where(
      and(
        eq(playerProfiles.profileStatus, "approved"),
        eq(users.status, "active"),
        sql`${users.role} <> 'organizer'`,
      ),
    )
    .orderBy(asc(playerProfiles.displayName));

  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    emailMasked: maskEmail(r.email),
    role: r.role,
  }));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startDraft(
  actor: Actor,
  draftId: string,
): Promise<DraftResult> {
  if (actor.role !== "organizer") return forbidden();

  const draft = await requireDraft(draftId);
  if (!draft) return notFoundDraft();
  if (draft.status !== "setup") return frozenDraft();

  const readiness = await getDraftReadiness(draftId);
  if (!readiness.ready) {
    return {
      ok: false,
      error: "not-ready",
      message: `Draft cannot start yet: missing ${readiness.missing.join(", ")}.`,
    };
  }

  const [updated] = await db
    .update(drafts)
    .set({ status: "active", startedAt: new Date(), currentPickNumber: 1 })
    .where(eq(drafts.id, draftId))
    .returning();

  await writeDraftAudit(actor.id, "draft.started", draftId, {});

  return { ok: true, draft: updated! };
}

export async function pauseDraft(
  actor: Actor,
  draftId: string,
  reason?: string,
): Promise<DraftResult> {
  if (actor.role !== "organizer") return forbidden();

  const draft = await requireDraft(draftId);
  if (!draft) return notFoundDraft();
  if (draft.status !== "active") {
    return {
      ok: false,
      error: "invalid-state",
      message: "Only an active draft can be paused.",
    };
  }

  const [updated] = await db
    .update(drafts)
    .set({ status: "paused", pausedAt: new Date() })
    .where(eq(drafts.id, draftId))
    .returning();

  await writeDraftAudit(actor.id, "draft.paused", draftId, {
    reason: reason?.trim() || null,
  });

  return { ok: true, draft: updated! };
}

export async function resumeDraft(
  actor: Actor,
  draftId: string,
): Promise<DraftResult> {
  if (actor.role !== "organizer") return forbidden();

  const draft = await requireDraft(draftId);
  if (!draft) return notFoundDraft();
  if (draft.status !== "paused") {
    return {
      ok: false,
      error: "invalid-state",
      message: "Only a paused draft can be resumed.",
    };
  }

  const [updated] = await db
    .update(drafts)
    .set({ status: "active", pausedAt: null })
    .where(eq(drafts.id, draftId))
    .returning();

  await writeDraftAudit(actor.id, "draft.resumed", draftId, {});

  return { ok: true, draft: updated! };
}

export async function completeDraft(
  actor: Actor,
  draftId: string,
): Promise<DraftResult> {
  if (actor.role !== "organizer") return forbidden();

  const draft = await requireDraft(draftId);
  if (!draft) return notFoundDraft();
  if (draft.status !== "active" && draft.status !== "paused") {
    return {
      ok: false,
      error: "invalid-state",
      message: "Only an active or paused draft can be completed.",
    };
  }

  const [updated] = await db
    .update(drafts)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(drafts.id, draftId))
    .returning();

  await writeDraftAudit(actor.id, "draft.completed", draftId, {});

  return { ok: true, draft: updated! };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function validateRounds(rounds: number): DraftResult | null {
  if (
    !Number.isInteger(rounds) ||
    rounds < MIN_ROUNDS ||
    rounds > MAX_ROUNDS
  ) {
    return {
      ok: false,
      error: "invalid-rounds",
      message: `Rounds must be an integer between ${MIN_ROUNDS} and ${MAX_ROUNDS}.`,
    };
  }
  return null;
}

/** Returns null when eligible, otherwise the error to return. */
async function checkCaptainEligibility(
  captainUserId: string,
): Promise<AssignmentResult | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, captainUserId))
    .limit(1);
  if (!user) {
    return notFoundAssignment("No user found with that id.");
  }
  if (user.status !== "active" || user.role === "organizer") {
    return ineligibleCaptain();
  }
  const [profile] = await db
    .select({ status: playerProfiles.profileStatus })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, captainUserId))
    .limit(1);
  if (!profile || profile.status !== "approved") {
    return ineligibleCaptain();
  }
  return null;
}

function ineligibleCaptain(): AssignmentResult {
  return {
    ok: false,
    error: "captain-not-eligible",
    message:
      "Captains must be active users with an approved player profile.",
  };
}

async function requireDraft(draftId: string) {
  return getDraftById(draftId);
}

function forbidden(): DraftResult {
  return {
    ok: false,
    error: "forbidden",
    message: "You do not have permission to perform this action.",
  };
}

function forbiddenAssignment(): AssignmentResult {
  return {
    ok: false,
    error: "forbidden",
    message: "You do not have permission to perform this action.",
  };
}

function notFoundDraft(): DraftResult {
  return {
    ok: false,
    error: "not-found",
    message: "No draft found with that id.",
  };
}

function frozenDraft(): DraftResult {
  return {
    ok: false,
    error: "invalid-state",
    message: "This change is only allowed while the draft is in setup.",
  };
}

function notFoundAssignment(message: string): AssignmentResult {
  return { ok: false, error: "not-found", message };
}

async function writeDraftAudit(
  actorId: string,
  action: string,
  draftId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: actorId,
    action,
    entityType: "draft",
    entityId: draftId,
    metadata,
  });
}
