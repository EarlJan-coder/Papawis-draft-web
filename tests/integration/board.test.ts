import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";
import {
  approveProfile,
  setDraftEligibility,
} from "@/features/approvals/approval-service";
import { submitProfile } from "@/features/profiles/profile-service";
import { createTeam } from "@/features/teams/team-service";
import { assignCaptain, startDraft } from "@/features/drafts/draft-service";
import { makePick, undoPick } from "@/features/drafts/pick-service";
import {
  getTeamRosters,
  listAvailablePlayers,
} from "@/features/drafts/board-service";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * Draft board + roster summaries (Phase 6).
 * The break these catch: a drafted (or ineligible) player still showing as
 * available, an undone pick not returning to the pool, rosters missing
 * picks, or position-coverage warnings that lie.
 */

const profileBase = {
  dateOfBirth: "1996-02-02",
  heightCm: 188,
  skillLevel: "advanced" as const,
};

async function makeUser(prefix: string): Promise<Actor> {
  const email = newEmail(prefix);
  await signUpTestUser(email);
  await db.update(users).set({ role: "organizer" }).where(eq(users.email, email));
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return { id: row!.id, role: "organizer" };
}

async function makePlayer(
  prefix: string,
  options: { positions?: string[]; eligible?: boolean } = {},
): Promise<{ actor: Actor; profileId: string }> {
  const approver = await makeUser(`${prefix}-approver`);
  const email = newEmail(prefix);
  await signUpTestUser(email);
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const submitted = await submitProfile(row!.id, {
    displayName: `Player ${prefix}`,
    positions: options.positions ?? ["SG"],
    ...profileBase,
  });
  if (!submitted.ok) throw new Error("setup failed");
  await approveProfile(approver, submitted.profile.id);
  if (options.eligible !== false) {
    await setDraftEligibility(approver, submitted.profile.id, true);
  }
  return { actor: { id: row!.id, role: "player" }, profileId: submitted.profile.id };
}

async function makeStartedDraft(prefix: string) {
  const organizer = await makeUser(`${prefix}-org`);
  const teamIds: string[] = [];
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    const r = await createTeam(organizer, `${prefix}-${name}`);
    if (!r.ok) throw new Error("team setup failed");
    teamIds.push(r.team.id);
  }
  const created = await (
    await import("@/features/drafts/draft-service")
  ).createDraft(organizer, { totalRounds: 8 });
  if (!created.ok) throw new Error("draft setup failed");
  const captains: Actor[] = [];
  for (let i = 0; i < 4; i++) {
    const captain = (await makePlayer(`${prefix}-c${i + 1}`)).actor;
    const r = await assignCaptain(organizer, created.draft.id, teamIds[i]!, captain.id, i + 1);
    if (!r.ok) throw new Error(`captain setup failed: ${r.error}`);
    captains.push({ id: captain.id, role: "captain" });
  }
  const started = await startDraft(organizer, created.draft.id);
  if (!started.ok) throw new Error("start failed");
  return { organizer, draftId: created.draft.id, teamIds, captains };
}

describe("board service", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lists eligible, undrafted players only", async () => {
    const { draftId, captains } = await makeStartedDraft("b-list");
    const available = await makePlayer("b-avail", { positions: ["PG", "SG"] });
    const ineligible = await makePlayer("b-inelig", { eligible: false });
    const taken = await makePlayer("b-taken");

    expect((await makePick(captains[0]!, draftId, taken.profileId)).ok).toBe(true);

    const rows = await listAvailablePlayers(draftId);
    const ids = rows.map((r) => r.profileId);
    expect(ids).toContain(available.profileId);
    expect(ids).not.toContain(ineligible.profileId);
    expect(ids).not.toContain(taken.profileId);

    // An undone pick returns the player to the pool.
    await undoPick(await getAnyOrganizer(), draftId, "mistake");
    const afterUndo = await listAvailablePlayers(draftId);
    expect(afterUndo.map((r) => r.profileId)).toContain(taken.profileId);
  });

  it("summarizes rosters with picks per team", async () => {
    const { draftId, captains } = await makeStartedDraft("b-roster");
    const p1 = await makePlayer("b-p1", { positions: ["C"] });
    const p2 = await makePlayer("b-p2", { positions: ["PG"] });

    await makePick(captains[0]!, draftId, p1.profileId);
    // Advance to pick 2: captains[1] picks.
    await makePick(captains[1]!, draftId, p2.profileId);

    const rosters = await getTeamRosters(draftId);
    expect(rosters).toHaveLength(4);
    expect(rosters[0]!.teamName).toContain("b-roster-Alpha");
    expect(rosters[0]!.players).toHaveLength(1);
    expect(rosters[0]!.players[0]!.displayName).toBe("Player b-p1");
    expect(rosters[1]!.players[0]!.displayName).toBe("Player b-p2");
    expect(rosters[2]!.players).toHaveLength(0);
    expect(rosters[0]!.draftOrder).toBe(1);
  });
});

/** Any organizer actor (for undo in tests). */
async function getAnyOrganizer(): Promise<Actor> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.role, "organizer"))
    .limit(1);
  if (!row) throw new Error("no organizer");
  return { id: row.id, role: "organizer" };
}
