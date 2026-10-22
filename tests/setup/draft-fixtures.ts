import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";
import {
  approveProfile,
  setDraftEligibility,
} from "@/features/approvals/approval-service";
import { submitProfile } from "@/features/profiles/profile-service";
import { createTeam } from "@/features/teams/team-service";
import {
  assignCaptain,
  createDraft,
  startDraft,
} from "@/features/drafts/draft-service";
import { makePick } from "@/features/drafts/pick-service";
import { newEmail, signUpTestUser } from "./helpers";

/**
 * Shared draft fixtures for integration tests that need a fully started
 * draft (Phase 7+ tests). Picks reference profile ids, not user ids, and
 * assigning a captain promotes the user's role — the returned actors
 * reflect the promoted role.
 */

export const profileBase = {
  positions: ["PG"] as string[],
  dateOfBirth: "1997-07-01",
  heightCm: 181,
  skillLevel: "intermediate" as const,
};

export type TestUser = Actor & { email: string };

export async function makeUser(
  prefix: string,
  role: "player" | "captain" | "organizer" = "organizer",
): Promise<TestUser> {
  const email = newEmail(prefix);
  await signUpTestUser(email);
  await db.update(users).set({ role }).where(eq(users.email, email));
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!row) throw new Error("test user missing");
  return { id: row.id, role: row.role, email };
}

/** An approved + draft-eligible player. Returns the profile id for picks. */
export async function makeEligiblePlayer(
  prefix: string,
): Promise<Actor & { profileId: string }> {
  const approver = await makeUser(`${prefix}-approver`);
  const email = newEmail(prefix);
  await signUpTestUser(email);
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const submitted = await submitProfile(row!.id, {
    ...profileBase,
    displayName: `Player ${prefix}`,
  });
  if (!submitted.ok) throw new Error("setup failed");
  await approveProfile(approver, submitted.profile.id);
  await setDraftEligibility(approver, submitted.profile.id, true);
  return { id: row!.id, role: "player", profileId: submitted.profile.id };
}

export type StartedDraft = {
  organizer: TestUser;
  draftId: string;
  teamIds: string[];
  /** Captains in draft order 1-4. */
  captains: (Actor & { profileId: string })[];
};

/** Teams + draft + four captains assigned + started. */
export async function makeStartedDraft(
  prefix: string,
  rounds = 8,
  customCaptains?: (Actor & { profileId: string })[],
): Promise<StartedDraft> {
  const organizer = await makeUser(`${prefix}-org`);
  const teamIds: string[] = [];
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    const r = await createTeam(organizer, `${prefix}-${name}`);
    if (!r.ok) throw new Error("team setup failed");
    teamIds.push(r.team.id);
  }

  const created = await createDraft(organizer, { totalRounds: rounds });
  if (!created.ok) throw new Error("draft setup failed");

  const captains: (Actor & { profileId: string })[] = [];
  for (let i = 0; i < 4; i++) {
    // Custom captains (e.g. HTTP tests that hold those users' session
    // cookies) are used as-is; they must already be approved + eligible.
    const captain =
      customCaptains?.[i] ??
      ({ ...(await makeEligiblePlayer(`${prefix}-c${i + 1}`)), role: "captain" });
    const r = await assignCaptain(
      organizer,
      created.draft.id,
      teamIds[i]!,
      captain.id,
      i + 1,
    );
    if (!r.ok) throw new Error(`captain setup failed: ${r.error}`);
    captains.push({ ...captain, role: "captain" });
  }

  const started = await startDraft(organizer, created.draft.id);
  if (!started.ok) throw new Error("start failed");

  return { organizer, draftId: created.draft.id, teamIds, captains };
}

/** Snake-order captain index for a 1-based pick number. */
export function captainIndexFor(pickNumber: number): number {
  const round = Math.ceil(pickNumber / 4);
  const pos = (pickNumber - 1) % 4;
  return round % 2 === 1 ? pos : 3 - pos;
}

/** Fills pick numbers `from`..`to` in snake order. */
export async function fillPickRange(
  prefix: string,
  draftId: string,
  captains: (Actor & { profileId: string })[],
  from: number,
  to: number,
): Promise<void> {
  for (let n = from; n <= to; n++) {
    const player = await makeEligiblePlayer(`${prefix}-p${n}`);
    const r = await makePick(
      captains[captainIndexFor(n)]!,
      draftId,
      player.profileId,
    );
    if (!r.ok) throw new Error(`pick ${n} failed: ${r.error}`);
  }
}

/** Fills every pick of a `rounds`-round draft (auto-completes on the last). */
export async function fillAllPicks(
  prefix: string,
  draftId: string,
  captains: (Actor & { profileId: string })[],
  rounds: number,
): Promise<void> {
  await fillPickRange(prefix, draftId, captains, 1, rounds * 4);
}
