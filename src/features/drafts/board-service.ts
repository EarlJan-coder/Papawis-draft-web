import { and, asc, eq, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db";
import {
  draftPicks,
  draftTeamAssignments,
  playerProfiles,
  teams,
  users,
} from "@/db/schema";

/**
 * Draft board + roster summaries (Phase 6).
 *
 * `listAvailablePlayers` is the pool captains draft from: approved,
 * draft-eligible profiles without an ACTIVE pick in this draft (an undone
 * pick returns the player to the pool). `getTeamRosters` summarizes each
 * team's selections for the roster panels.
 */

export type AvailablePlayer = {
  profileId: string;
  displayName: string;
  positions: string[];
  heightCm: number | null;
  skillLevel: string | null;
  experience: string | null;
  photoUrl: string | null;
  ageYears: number | null;
};

export async function listAvailablePlayers(
  draftId: string,
): Promise<AvailablePlayer[]> {
  // Players already holding an active pick in this draft.
  const drafted = await db
    .select({ playerId: draftPicks.playerId })
    .from(draftPicks)
    .where(and(eq(draftPicks.draftId, draftId), isNull(draftPicks.undoneAt)));
  const draftedIds = drafted.map((d) => d.playerId);

  const rows = await db
    .select({
      profileId: playerProfiles.id,
      displayName: playerProfiles.displayName,
      positions: playerProfiles.positions,
      heightCm: playerProfiles.heightCm,
      skillLevel: playerProfiles.skillLevel,
      experience: playerProfiles.experience,
      photoUrl: playerProfiles.photoUrl,
      dateOfBirth: playerProfiles.dateOfBirth,
    })
    .from(playerProfiles)
    .where(
      and(
        eq(playerProfiles.profileStatus, "approved"),
        eq(playerProfiles.isDraftEligible, true),
        draftedIds.length > 0
          ? notInArray(playerProfiles.id, draftedIds)
          : undefined,
      ),
    );

  return rows
    .map((r) => ({
      profileId: r.profileId,
      displayName: r.displayName,
      positions: r.positions,
      heightCm: r.heightCm,
      skillLevel: r.skillLevel,
      experience: r.experience,
      photoUrl: r.photoUrl,
      ageYears: r.dateOfBirth ? ageYearsFromDbDate(r.dateOfBirth) : null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export type RosterSummary = {
  teamId: string;
  teamName: string;
  draftOrder: number;
  captainUserId: string;
  captainName: string | null;
  players: {
    pickNumber: number;
    profileId: string;
    displayName: string;
    positions: string[];
    heightCm: number | null;
    skillLevel: string | null;
  }[];
};

/** One entry per team in the draft, in draft order, with their picks. */
export async function getTeamRosters(
  draftId: string,
): Promise<RosterSummary[]> {
  const assignments = await db
    .select({
      teamId: draftTeamAssignments.teamId,
      teamName: teams.name,
      draftOrder: draftTeamAssignments.draftOrder,
      captainUserId: draftTeamAssignments.captainUserId,
      captainName: users.name,
    })
    .from(draftTeamAssignments)
    .innerJoin(teams, eq(draftTeamAssignments.teamId, teams.id))
    .leftJoin(users, eq(draftTeamAssignments.captainUserId, users.id))
    .where(eq(draftTeamAssignments.draftId, draftId))
    .orderBy(asc(draftTeamAssignments.draftOrder));

  const picks = await db
    .select({
      pickNumber: draftPicks.pickNumber,
      teamId: draftPicks.teamId,
      profileId: playerProfiles.id,
      displayName: playerProfiles.displayName,
      positions: playerProfiles.positions,
      heightCm: playerProfiles.heightCm,
      skillLevel: playerProfiles.skillLevel,
    })
    .from(draftPicks)
    .innerJoin(playerProfiles, eq(draftPicks.playerId, playerProfiles.id))
    .where(and(eq(draftPicks.draftId, draftId), isNull(draftPicks.undoneAt)))
    .orderBy(asc(draftPicks.pickNumber));

  return assignments.map((a) => ({
    teamId: a.teamId,
    teamName: a.teamName,
    draftOrder: a.draftOrder,
    captainUserId: a.captainUserId,
    captainName: a.captainName,
    players: picks
      .filter((p) => p.teamId === a.teamId)
      .map((p) => ({
        pickNumber: p.pickNumber,
        profileId: p.profileId,
        displayName: p.displayName,
        positions: p.positions,
        heightCm: p.heightCm,
        skillLevel: p.skillLevel,
      })),
  }));
}

export type DraftHistoryEntry = {
  pickNumber: number;
  playerName: string;
  teamName: string;
  pickedAt: Date;
  undoneAt: Date | null;
  undoReason: string | null;
};

/** Full pick history for the draft room, including undone picks. */
export async function getDraftHistory(
  draftId: string,
): Promise<DraftHistoryEntry[]> {
  const rows = await db
    .select({
      pickNumber: draftPicks.pickNumber,
      pickedAt: draftPicks.pickedAt,
      undoneAt: draftPicks.undoneAt,
      undoReason: draftPicks.undoReason,
      playerName: playerProfiles.displayName,
      teamName: teams.name,
    })
    .from(draftPicks)
    .innerJoin(playerProfiles, eq(draftPicks.playerId, playerProfiles.id))
    .innerJoin(teams, eq(draftPicks.teamId, teams.id))
    .where(eq(draftPicks.draftId, draftId))
    .orderBy(asc(draftPicks.pickNumber));

  return rows;
}

/**
 * Postgres `date` columns arrive as "YYYY-MM-DD" strings from node-postgres
 * (never Date objects) — parse accordingly.
 */
function ageYearsFromDbDate(dateOfBirth: string | Date): number {  const dob =
    typeof dateOfBirth === "string"
      ? new Date(`${dateOfBirth}T00:00:00.000Z`)
      : dateOfBirth;
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - dob.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getUTCDate() < dob.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}
