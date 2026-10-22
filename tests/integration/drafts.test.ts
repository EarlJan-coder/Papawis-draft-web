import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, drafts, users } from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";
import { approveProfile, setDraftEligibility } from "@/features/approvals/approval-service";
import { submitProfile } from "@/features/profiles/profile-service";
import { createTeam } from "@/features/teams/team-service";
import {
  assignCaptain,
  completeDraft,
  createDraft,
  getDraftReadiness,
  getCurrentDraft,
  pauseDraft,
  removeAssignment,
  resumeDraft,
  setDraftRounds,
  startDraft,
} from "@/features/drafts/draft-service";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * Draft creation, captain assignment, and lifecycle (Phase 4).
 * The break these catch: starting an under-configured draft, double
 * captains/orders, assigning unvetted or inactive captains, illegal
 * lifecycle transitions, or a non-organizer driving any of it.
 */

const profile = {
  displayName: "Player One",
  positions: ["PG"],
  dateOfBirth: "1998-03-10",
  heightCm: 180,
  skillLevel: "intermediate" as const,
};

async function makeUser(
  prefix: string,
  role: "player" | "organizer" = "organizer",
): Promise<Actor> {
  const email = newEmail(prefix);
  await signUpTestUser(email);
  await db.update(users).set({ role }).where(eq(users.email, email));
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!row) throw new Error("test user missing");
  return { id: row.id, role: row.role };
}

/** An approved (and draft-eligible) player, as the organizer would assign. */
async function makeApprovedPlayer(prefix: string): Promise<Actor> {
  const organizer = await makeUser(`${prefix}-approver`);
  const email = newEmail(prefix);
  await signUpTestUser(email);
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const submitted = await submitProfile(row!.id, {
    ...profile,
    displayName: `Player ${prefix}`,
  });
  if (!submitted.ok) throw new Error("setup failed");
  await approveProfile(organizer, submitted.profile.id);
  await setDraftEligibility(organizer, submitted.profile.id, true);
  return { id: row!.id, role: "player" };
}

async function makeLeague(prefix: string): Promise<{
  organizer: Actor;
  teamIds: string[];
  draftId: string;
}> {
  const organizer = await makeUser(`${prefix}-org`);
  const teamIds: string[] = [];
  for (const name of ["Alpha", "Beta", "Gamma", "Delta"]) {
    const r = await createTeam(organizer, `${prefix}-${name}`);
    if (!r.ok) throw new Error("team setup failed");
    teamIds.push(r.team.id);
  }
  const created = await createDraft(organizer, {});
  if (!created.ok) throw new Error("draft setup failed");
  return { organizer, teamIds, draftId: created.draft.id };
}

/** Assign four captains in order 1-4 and return them. */
async function assignFourCaptains(
  organizer: Actor,
  draftId: string,
  teamIds: string[],
  prefix: string,
): Promise<Actor[]> {
  const captains: Actor[] = [];
  for (let i = 0; i < 4; i++) {
    const captain = await makeApprovedPlayer(`${prefix}-c${i + 1}`);
    const r = await assignCaptain(organizer, draftId, teamIds[i]!, captain.id, i + 1);
    if (!r.ok) throw new Error(`assignment setup failed: ${r.error}`);
    captains.push(captain);
  }
  return captains;
}

describe("draft service", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  describe("draft creation", () => {
    it("creates a single setup draft with default rounds", async () => {
      const organizer = await makeUser("d-create");
      const result = await createDraft(organizer, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.status).toBe("setup");
      expect(result.draft.totalRounds).toBe(8);
      expect(result.draft.currentPickNumber).toBe(1);

      const stored = await getCurrentDraft();
      expect(stored?.id).toBe(result.draft.id);
    });

    it("refuses a second non-completed draft", async () => {
      const organizer = await makeUser("d-single");
      const first = await createDraft(organizer, { totalRounds: 6 });
      expect(first.ok).toBe(true);

      const second = await createDraft(organizer, {});
      expect(second).toMatchObject({ ok: false, error: "draft-exists" });

      const stored = await getCurrentDraft();
      expect(stored?.totalRounds).toBe(6);
    });

    it("only an organizer can create a draft", async () => {
      const player = await makeUser("d-forbidden", "player");
      expect(await createDraft(player, {})).toMatchObject({
        ok: false,
        error: "forbidden",
      });
    });

    it("validates rounds at creation", async () => {
      const organizer = await makeUser("d-rounds");
      expect(await createDraft(organizer, { totalRounds: 0 })).toMatchObject({
        ok: false,
        error: "invalid-rounds",
      });
      expect(await createDraft(organizer, { totalRounds: 21 })).toMatchObject({
        ok: false,
        error: "invalid-rounds",
      });
    });
  });

  describe("captain assignment", () => {
    it("assigns a captain, sets their role, and audits it", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-happy");
      const captain = await makeApprovedPlayer("a-happy");

      const result = await assignCaptain(organizer, draftId, teamIds[0]!, captain.id, 1);
      expect(result.ok).toBe(true);

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, captain.id))
        .limit(1);
      expect(user?.role).toBe("captain");

      const events = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, draftId));
      expect(
        events.filter((e) => e.action === "draft.captain_assigned"),
      ).toHaveLength(1);
    });

    it("rejects a captain without an approved profile", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-pending");
      const email = newEmail("a-pending");
      await signUpTestUser(email);
      const [pending] = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      await submitProfile(pending!.id, profile); // stays pending

      const result = await assignCaptain(
        organizer,
        draftId,
        teamIds[0]!,
        pending!.id,
        1,
      );
      expect(result).toMatchObject({
        ok: false,
        error: "captain-not-eligible",
      });
    });

    it("rejects a user with no profile at all", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-noprofile");
      const bare = await makeUser("a-nope", "player");

      const result = await assignCaptain(organizer, draftId, teamIds[0]!, bare.id, 1);
      expect(result).toMatchObject({
        ok: false,
        error: "captain-not-eligible",
      });
    });

    it("rejects a suspended user even with an approved profile", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-suspended");
      const captain = await makeApprovedPlayer("a-suspended");
      await db
        .update(users)
        .set({ status: "suspended" })
        .where(eq(users.id, captain.id));

      const result = await assignCaptain(organizer, draftId, teamIds[0]!, captain.id, 1);
      expect(result).toMatchObject({
        ok: false,
        error: "captain-not-eligible",
      });
    });

    it("rejects the same captain on two teams", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-dupe");
      const captain = await makeApprovedPlayer("a-dupe");
      await assignCaptain(organizer, draftId, teamIds[0]!, captain.id, 1);

      const result = await assignCaptain(organizer, draftId, teamIds[1]!, captain.id, 2);
      expect(result).toMatchObject({ ok: false, error: "captain-conflict" });
    });

    it("rejects duplicate or out-of-range draft order", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-order");
      const c1 = await makeApprovedPlayer("a-order-1");
      const c2 = await makeApprovedPlayer("a-order-2");
      await assignCaptain(organizer, draftId, teamIds[0]!, c1.id, 1);

      const taken = await assignCaptain(organizer, draftId, teamIds[1]!, c2.id, 1);
      expect(taken).toMatchObject({ ok: false, error: "order-taken" });

      const tooHigh = await assignCaptain(organizer, draftId, teamIds[1]!, c2.id, 5);
      expect(tooHigh).toMatchObject({ ok: false, error: "invalid-order" });

      const tooLow = await assignCaptain(organizer, draftId, teamIds[1]!, c2.id, 0);
      expect(tooLow).toMatchObject({ ok: false, error: "invalid-order" });
    });

    it("rejects assignment for an unknown team or user", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-ghost");
      const captain = await makeApprovedPlayer("a-ghost");

      const ghostTeam = await assignCaptain(
        organizer,
        draftId,
        "00000000-0000-4000-8000-000000000000",
        captain.id,
        1,
      );
      expect(ghostTeam).toMatchObject({ ok: false, error: "not-found" });

      const ghostUser = await assignCaptain(
        organizer,
        draftId,
        teamIds[0]!,
        "00000000-0000-4000-8000-000000000000",
        1,
      );
      expect(ghostUser).toMatchObject({ ok: false, error: "not-found" });
    });

    it("freezes assignment once the draft is active", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-frozen");
      await assignFourCaptains(organizer, draftId, teamIds, "a-frozen");
      const started = await startDraft(organizer, draftId);
      expect(started.ok).toBe(true);

      const late = await makeApprovedPlayer("a-late");
      const result = await assignCaptain(organizer, draftId, teamIds[0]!, late.id, 1);
      expect(result).toMatchObject({ ok: false, error: "invalid-state" });
    });

    it("removes an assignment in setup only", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("a-remove");
      await assignFourCaptains(organizer, draftId, teamIds, "a-remove");

      const removed = await removeAssignment(organizer, draftId, teamIds[2]!);
      expect(removed.ok).toBe(true);

      // Order 3 is free again.
      const captain = await makeApprovedPlayer("a-again");
      const reassigned = await assignCaptain(organizer, draftId, teamIds[2]!, captain.id, 3);
      expect(reassigned.ok).toBe(true);

      await startDraft(organizer, draftId);
      const frozen = await removeAssignment(organizer, draftId, teamIds[2]!);
      expect(frozen).toMatchObject({ ok: false, error: "invalid-state" });

      const ghost = await removeAssignment(
        organizer,
        draftId,
        "00000000-0000-4000-8000-000000000000",
      );
      expect(ghost).toMatchObject({ ok: false, error: "not-found" });
    });

    it("only an organizer can assign or remove captains", async () => {
      const { draftId, teamIds } = await makeLeague("a-forbidden");
      const player = await makeUser("a-forbidden-player", "player");
      const captain = await makeApprovedPlayer("a-forbidden-c");

      expect(
        await assignCaptain(player, draftId, teamIds[0]!, captain.id, 1),
      ).toMatchObject({ ok: false, error: "forbidden" });
      expect(await removeAssignment(player, draftId, teamIds[0]!)).toMatchObject({
        ok: false,
        error: "forbidden",
      });
    });
  });

  describe("readiness + lifecycle", () => {
    it("reports what is missing before start", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("r-missing");

      const early = await getDraftReadiness(draftId);
      expect(early.ready).toBe(false);
      expect(early.missing).toContain("captains");

      await assignFourCaptains(organizer, draftId, teamIds, "r-missing");
      const ready = await getDraftReadiness(draftId);
      expect(ready.ready).toBe(true);
      expect(ready.missing).toHaveLength(0);
    });

    it("refuses to start an incomplete draft", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("r-incomplete");
      const c1 = await makeApprovedPlayer("r-c1");
      await assignCaptain(organizer, draftId, teamIds[0]!, c1.id, 1);

      const result = await startDraft(organizer, draftId);
      expect(result).toMatchObject({ ok: false, error: "not-ready" });
      if (result.ok) return;

      const [stored] = await db
        .select()
        .from(drafts)
        .where(eq(drafts.id, draftId))
        .limit(1);
      expect(stored?.status).toBe("setup");
    });

    it("starts a ready draft, sets startedAt, and audits it", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("r-start");
      await assignFourCaptains(organizer, draftId, teamIds, "r-start");

      const result = await startDraft(organizer, draftId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.draft.status).toBe("active");
      expect(result.draft.startedAt).toBeInstanceOf(Date);

      const events = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityId, draftId));
      expect(events.filter((e) => e.action === "draft.started")).toHaveLength(1);

      const again = await startDraft(organizer, draftId);
      expect(again).toMatchObject({ ok: false, error: "invalid-state" });
    });

    it("rounds can be changed in setup only", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("r-rounds");

      const changed = await setDraftRounds(organizer, draftId, 5);
      expect(changed.ok).toBe(true);

      expect(await setDraftRounds(organizer, draftId, 0)).toMatchObject({
        ok: false,
        error: "invalid-rounds",
      });

      await assignFourCaptains(organizer, draftId, teamIds, "r-rounds");
      await startDraft(organizer, draftId);
      const frozen = await setDraftRounds(organizer, draftId, 6);
      expect(frozen).toMatchObject({ ok: false, error: "invalid-state" });
    });

    it("pauses and resumes an active draft", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("r-pause");
      await assignFourCaptains(organizer, draftId, teamIds, "r-pause");
      await startDraft(organizer, draftId);

      const paused = await pauseDraft(organizer, draftId, "Court unavailable");
      expect(paused.ok).toBe(true);
      if (!paused.ok) return;
      expect(paused.draft.status).toBe("paused");
      expect(paused.draft.pausedAt).toBeInstanceOf(Date);

      const resumed = await resumeDraft(organizer, draftId);
      expect(resumed.ok).toBe(true);
      if (!resumed.ok) return;
      expect(resumed.draft.status).toBe("active");

      // Illegal transitions.
      expect(await resumeDraft(organizer, draftId)).toMatchObject({
        ok: false,
        error: "invalid-state",
      });
    });

    it("cannot pause a draft that never started", async () => {
      const { organizer, draftId } = await makeLeague("r-pause-early");
      expect(await pauseDraft(organizer, draftId)).toMatchObject({
        ok: false,
        error: "invalid-state",
      });
    });

    it("completes from active or paused but never from setup, and only once", async () => {
      const { organizer, draftId, teamIds } = await makeLeague("r-complete");

      const early = await completeDraft(organizer, draftId);
      expect(early).toMatchObject({ ok: false, error: "invalid-state" });

      await assignFourCaptains(organizer, draftId, teamIds, "r-complete");
      await startDraft(organizer, draftId);
      await pauseDraft(organizer, draftId);

      const done = await completeDraft(organizer, draftId);
      expect(done.ok).toBe(true);
      if (!done.ok) return;
      expect(done.draft.status).toBe("completed");
      expect(done.draft.completedAt).toBeInstanceOf(Date);

      const again = await completeDraft(organizer, draftId);
      expect(again).toMatchObject({ ok: false, error: "invalid-state" });
    });

    it("only an organizer may drive the lifecycle", async () => {
      const { draftId, teamIds } = await makeLeague("r-forbidden");
      await assignFourCaptains(
        await makeUser("r-forbidden-org"),
        draftId,
        teamIds,
        "r-forbidden",
      );
      const player = await makeUser("r-forbidden-player", "player");

      expect(await startDraft(player, draftId)).toMatchObject({
        ok: false,
        error: "forbidden",
      });
      expect(await pauseDraft(player, draftId)).toMatchObject({
        ok: false,
        error: "forbidden",
      });
      expect(await resumeDraft(player, draftId)).toMatchObject({
        ok: false,
        error: "forbidden",
      });
      expect(await completeDraft(player, draftId)).toMatchObject({
        ok: false,
        error: "forbidden",
      });
      expect(await setDraftRounds(player, draftId, 4)).toMatchObject({
        ok: false,
        error: "forbidden",
      });
    });

    it("acting on an unknown draft fails cleanly", async () => {
      const organizer = await makeUser("r-ghost");
      const ghost = "00000000-0000-4000-8000-000000000000";
      expect(await startDraft(organizer, ghost)).toMatchObject({
        ok: false,
        error: "not-found",
      });
      expect(await getDraftReadiness(ghost)).toMatchObject({
        ready: false,
      });
    });
  });
});
