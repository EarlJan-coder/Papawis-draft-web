import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  draftPicks,
  draftTeamAssignments,
  drafts,
  playerProfiles,
  teams,
  users,
} from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";
import { snakeTeamIdForPick, totalPicks } from "./snake-order";

/**
 * Transactional pick service (Phase 5).
 *
 * The server is the source of truth for whose turn it is: every pick runs
 * inside a transaction that holds a row lock on the draft, re-derives the
 * on-turn team from the stored cursor + snake order, and only then checks
 * the actor and the player. Concurrent requests serialize on the lock, so
 * exactly one can consume a pick number. Retries are made safe with an
 * optional client idempotency key. Undo is a soft reversal of the LAST
 * pick only, organizer-only, with an audit trail.
 */

export type PickErrorCode =
  | "forbidden"
  | "not-found"
  | "invalid-state"
  | "draft-paused"
  | "not-your-turn"
  | "not-eligible"
  | "already-drafted";

export type PickResult =
  | { ok: true; pick: typeof draftPicks.$inferSelect; replayed?: boolean }
  | { ok: false; error: PickErrorCode; message: string };

export type UndoResult =
  | { ok: true; pick: typeof draftPicks.$inferSelect }
  | { ok: false; error: PickErrorCode; message: string };

export type DraftTurn = {
  pickNumber: number;
  teamId: string;
  teamName: string;
  captainUserId: string;
  captainName: string | null;
};

export async function makePick(
  actor: Actor,
  draftId: string,
  playerId: string,
  options: { idempotencyKey?: string } = {},
): Promise<PickResult> {
  if (actor.role !== "captain") {
    return {
      ok: false,
      error: "forbidden",
      message: "Only team captains can make picks.",
    };
  }

  const idempotencyKey =
    options.idempotencyKey && options.idempotencyKey.trim() !== ""
      ? options.idempotencyKey.trim().slice(0, 200)
      : null;

  return db.transaction(async (tx): Promise<PickResult> => {
    // Serialize all pick activity for this draft on the row lock.
    await tx.execute(
      sql`SELECT id FROM drafts WHERE id = ${draftId} FOR UPDATE`,
    );

    const [draft] = await tx
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    if (!draft) {
      return {
        ok: false,
        error: "not-found",
        message: "No draft found with that id.",
      };
    }

    // Idempotent replay: same key returns the original pick, no side effects.
    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(draftPicks)
        .where(
          and(
            eq(draftPicks.draftId, draftId),
            eq(draftPicks.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        return { ok: true, pick: existing, replayed: true };
      }
    }

    if (draft.status === "paused") {
      return {
        ok: false,
        error: "draft-paused",
        message: "The draft is paused. The organizer must resume it first.",
      };
    }
    if (draft.status !== "active") {
      return {
        ok: false,
        error: "invalid-state",
        message: "Picks can only be made in an active draft.",
      };
    }

    const assignments = await tx
      .select({
        assignment: draftTeamAssignments,
        teamName: teams.name,
        captainName: users.name,
      })
      .from(draftTeamAssignments)
      .innerJoin(teams, eq(draftTeamAssignments.teamId, teams.id))
      .leftJoin(users, eq(draftTeamAssignments.captainUserId, users.id))
      .where(eq(draftTeamAssignments.draftId, draftId))
      .orderBy(asc(draftTeamAssignments.draftOrder));

    if (assignments.length === 0) {
      return {
        ok: false,
        error: "invalid-state",
        message: "This draft has no team assignments.",
      };
    }

    const ordered = [...assignments].sort(
      (a, b) => a.assignment.draftOrder - b.assignment.draftOrder,
    );
    const onTurnTeamId = snakeTeamIdForPick(draft.currentPickNumber, {
      orderedTeamIds: ordered.map((a) => a.assignment.teamId),
    });
    const turn = ordered.find((a) => a.assignment.teamId === onTurnTeamId);

    if (!turn) {
      return {
        ok: false,
        error: "invalid-state",
        message: "Draft order is incomplete.",
      };
    }

    if (turn.assignment.captainUserId !== actor.id) {
      const captainOfThisActor = assignments.find(
        (a) => a.assignment.captainUserId === actor.id,
      );
      return {
        ok: false,
        error: captainOfThisActor ? "not-your-turn" : "forbidden",
        message: captainOfThisActor
          ? "It is not your team's turn to pick."
          : "You are not a captain in this draft.",
      };
    }

    const [player] = await tx
      .select({
        profileStatus: playerProfiles.profileStatus,
        isDraftEligible: playerProfiles.isDraftEligible,
      })
      .from(playerProfiles)
      .where(eq(playerProfiles.id, playerId))
      .limit(1);
    if (!player) {
      // Unknown id vs. a real user without a profile: different answers.
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, playerId))
        .limit(1);
      if (!user) {
        return {
          ok: false,
          error: "not-found",
          message: "No player found with that id.",
        };
      }
      return {
        ok: false,
        error: "not-eligible",
        message: "That player is not draft-eligible.",
      };
    }
    if (player.profileStatus !== "approved" || !player.isDraftEligible) {
      return {
        ok: false,
        error: "not-eligible",
        message: "That player is not draft-eligible.",
      };
    }

    const [alreadyTaken] = await tx
      .select({ id: draftPicks.id })
      .from(draftPicks)
      .where(
        and(
          eq(draftPicks.draftId, draftId),
          eq(draftPicks.playerId, playerId),
          isNull(draftPicks.undoneAt),
        ),
      )
      .limit(1);
    if (alreadyTaken) {
      return {
        ok: false,
        error: "already-drafted",
        message: "That player has already been drafted in this draft.",
      };
    }

    const [pick] = await tx
      .insert(draftPicks)
      .values({
        draftId,
        pickNumber: draft.currentPickNumber,
        teamId: turn.assignment.teamId,
        playerId,
        pickedByUserId: actor.id,
        idempotencyKey,
      })
      .returning();

    const nextPick = draft.currentPickNumber + 1;
    const finalPick = totalPicks(draft.totalRounds, assignments.length);
    if (nextPick > finalPick) {
      await tx
        .update(drafts)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(drafts.id, draftId));
      // Auto-completion is still a completion: record who finished it.
      await tx.insert(auditLogs).values({
        actorUserId: actor.id,
        action: "draft.completed",
        entityType: "draft",
        entityId: draftId,
        metadata: { auto: true, finalPickNumber: pick!.pickNumber },
      });
    } else {
      await tx
        .update(drafts)
        .set({ currentPickNumber: nextPick })
        .where(eq(drafts.id, draftId));
    }

    await tx.insert(auditLogs).values({
      actorUserId: actor.id,
      action: "draft.pick_made",
      entityType: "draft",
      entityId: draftId,
      metadata: {
        pickNumber: pick!.pickNumber,
        teamId: pick!.teamId,
        playerId,
      },
    });

    return { ok: true, pick: pick! };
  });
}

export async function undoPick(
  actor: Actor,
  draftId: string,
  reason: string,
): Promise<UndoResult> {
  if (actor.role !== "organizer") {
    return {
      ok: false,
      error: "forbidden",
      message: "Only the organizer can undo picks.",
    };
  }

  const trimmed = reason.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "invalid-state",
      message: "A reason is required to undo a pick.",
    };
  }

  return db.transaction(async (tx): Promise<UndoResult> => {
    await tx.execute(
      sql`SELECT id FROM drafts WHERE id = ${draftId} FOR UPDATE`,
    );

    const [draft] = await tx
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    if (!draft) {
      return {
        ok: false,
        error: "not-found",
        message: "No draft found with that id.",
      };
    }
    if (draft.status !== "active" && draft.status !== "paused") {
      return {
        ok: false,
        error: "invalid-state",
        message: "Only an active or paused draft can have picks undone.",
      };
    }

    const [last] = await tx
      .select()
      .from(draftPicks)
      .where(and(eq(draftPicks.draftId, draftId), isNull(draftPicks.undoneAt)))
      .orderBy(desc(draftPicks.pickNumber))
      .limit(1);
    if (!last) {
      return {
        ok: false,
        error: "invalid-state",
        message: "There is no pick to undo.",
      };
    }

    const [undone] = await tx
      .update(draftPicks)
      .set({
        undoneAt: new Date(),
        undoneByUserId: actor.id,
        undoReason: trimmed,
      })
      .where(eq(draftPicks.id, last.id))
      .returning();

    await tx
      .update(drafts)
      .set({ currentPickNumber: last.pickNumber })
      .where(eq(drafts.id, draftId));

    await tx.insert(auditLogs).values({
      actorUserId: actor.id,
      action: "draft.pick_undone",
      entityType: "draft",
      entityId: draftId,
      metadata: {
        pickNumber: last.pickNumber,
        playerId: last.playerId,
        teamId: last.teamId,
        reason: trimmed,
      },
    });

    return { ok: true, pick: undone! };
  });
}

/** All picks (including undone), in pick order — draft history. */
export async function listPicks(
  draftId: string,
): Promise<(typeof draftPicks.$inferSelect)[]> {
  return db
    .select()
    .from(draftPicks)
    .where(eq(draftPicks.draftId, draftId))
    .orderBy(asc(draftPicks.pickNumber));
}

/** Whose pick is it right now (null when the draft is not underway). */
export async function getDraftTurn(
  draftId: string,
): Promise<DraftTurn | null> {
  const [draft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.id, draftId))
    .limit(1);
  if (!draft || (draft.status !== "active" && draft.status !== "paused")) {
    return null;
  }

  const assignments = await db
    .select({
      assignment: draftTeamAssignments,
      teamName: teams.name,
      captainName: users.name,
    })
    .from(draftTeamAssignments)
    .innerJoin(teams, eq(draftTeamAssignments.teamId, teams.id))
    .leftJoin(users, eq(draftTeamAssignments.captainUserId, users.id))
    .where(eq(draftTeamAssignments.draftId, draftId))
    .orderBy(asc(draftTeamAssignments.draftOrder));
  if (assignments.length === 0) return null;

  const ordered = [...assignments].sort(
    (a, b) => a.assignment.draftOrder - b.assignment.draftOrder,
  );
  const onTurnTeamId = snakeTeamIdForPick(draft.currentPickNumber, {
    orderedTeamIds: ordered.map((a) => a.assignment.teamId),
  });
  const turn = ordered.find((a) => a.assignment.teamId === onTurnTeamId);
  if (!turn) return null;

  return {
    pickNumber: draft.currentPickNumber,
    teamId: turn.assignment.teamId,
    teamName: turn.teamName,
    captainUserId: turn.assignment.captainUserId,
    captainName: turn.captainName,
  };
}
