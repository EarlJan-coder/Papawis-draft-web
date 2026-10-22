import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, drafts, users } from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";
import {
  approveProfile,
  setDraftEligibility,
} from "@/features/approvals/approval-service";
import { submitProfile } from "@/features/profiles/profile-service";
import { createTeam } from "@/features/teams/team-service";
import {
  assignCaptain,
  completeDraft,
  createDraft,
  pauseDraft,
  resumeDraft,
  startDraft,
} from "@/features/drafts/draft-service";
import {
  getDraftTurn,
  listPicks,
  makePick,
  undoPick,
} from "@/features/drafts/pick-service";
import { POST as postPick } from "@/app/api/drafts/[draftId]/picks/route";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * Transactional pick service + HTTP layer (Phase 5).
 * The break these catch: picking out of turn, drafting an ineligible or
 * already-drafted player, picking while paused, a lost/duplicated retry
 * (idempotency), an undo that isn't the last pick, and — the big one —
 * two concurrent requests both succeeding for the same pick.
 */

const profileBase = {
  positions: ["PG"] as string[],
  dateOfBirth: "1997-07-01",
  heightCm: 181,
  skillLevel: "intermediate" as const,
};

async function makeUser(
  prefix: string,
  role: "player" | "captain" | "organizer" = "organizer",
): Promise<Actor> {
  const email = newEmail(prefix);
  await signUpTestUser(email);
  await db.update(users).set({ role }).where(eq(users.email, email));
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error("test user missing");
  return { id: row.id, role: row.role };
}

/** A registered user WITH their session-cookie headers. */
async function makeSessionUser(
  prefix: string,
  role: "player" | "captain" | "organizer" = "organizer",
): Promise<{ actor: Actor; headers: Headers }> {
  const email = newEmail(prefix);
  const headers = await signUpTestUser(email);
  await db.update(users).set({ role }).where(eq(users.email, email));
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error("test user missing");
  return { actor: { id: row.id, role: row.role }, headers };
}

/**
 * An approved + draft-eligible player. Returns the profile id (what picks
 * reference) alongside the user actor.
 */
async function makeEligiblePlayer(
  prefix: string,
): Promise<Actor & { profileId: string }> {
  const approver = await makeUser(`${prefix}-approver`);
  const email = newEmail(prefix);
  await signUpTestUser(email);
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const submitted = await submitProfile(row!.id, {
    ...profileBase,
    displayName: `Player ${prefix}`,
  });
  if (!submitted.ok) throw new Error("setup failed");
  await approveProfile(approver, submitted.profile.id);
  await setDraftEligibility(approver, submitted.profile.id, true);
  return { id: row!.id, role: "player", profileId: submitted.profile.id };
}

type StartedDraft = {
  organizer: Actor;
  draftId: string;
  teamIds: string[];
  /** Captains in draft order 1-4. */
  captains: Actor[];
};

/**
 * Builds a started draft. Pass `captains` to control exactly who leads each
 * team (needed for HTTP tests, which hold those users' session cookies).
 */
async function makeStartedDraft(
  prefix: string,
  rounds = 8,
  captains?: Actor[],
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

  const usedCaptains: Actor[] = [];
  for (let i = 0; i < 4; i++) {
    const captain = captains?.[i] ?? (await makeEligiblePlayer(`${prefix}-c${i + 1}`));
    const r = await assignCaptain(
      organizer,
      created.draft.id,
      teamIds[i]!,
      captain.id,
      i + 1,
    );
    if (!r.ok) throw new Error(`captain setup failed: ${r.error}`);
    // Assignment promotes the user; refresh the stale local role.
    usedCaptains.push({ id: captain.id, role: "captain" });
  }

  const started = await startDraft(organizer, created.draft.id);
  if (!started.ok) throw new Error("start failed");

  return {
    organizer,
    draftId: created.draft.id,
    teamIds,
    captains: usedCaptains,
  };
}

async function activePicks(draftId: string) {
  const all = await listPicks(draftId);
  return all.filter((p) => !p.undoneAt);
}

describe("pick service", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("derives the on-turn captain from snake order and records the pick", async () => {
    const { draftId, captains } = await makeStartedDraft("p-basic");
    const player = await makeEligiblePlayer("p-basic-pool");

    // Pick 1 belongs to draft order 1, not order 2.
    const wrong = await makePick(captains[1]!, draftId, player.profileId);
    expect(wrong).toMatchObject({ ok: false, error: "not-your-turn" });

    const result = await makePick(captains[0]!, draftId, player.profileId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pick.pickNumber).toBe(1);
    expect(result.pick.pickedByUserId).toBe(captains[0]!.id);

    const turn = await getDraftTurn(draftId);
    expect(turn?.pickNumber).toBe(2);
    expect(turn?.captainUserId).toBe(captains[1]!.id);

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, draftId));
    expect(events.filter((e) => e.action === "draft.pick_made")).toHaveLength(1);
  });

  it("snakes: after four picks the order-4 captain picks again", async () => {
    const { draftId, captains } = await makeStartedDraft("p-snake");

    for (let i = 0; i < 4; i++) {
      const player = await makeEligiblePlayer(`p-snake-p${i + 1}`);
      const r = await makePick(captains[i]!, draftId, player.profileId);
      expect(r.ok).toBe(true);
    }

    // Round 2 opens with the order-4 captain, not order-1.
    const early = await makePick(
      captains[0]!,
      draftId,
      (await makeEligiblePlayer("p-snake-late")).profileId,
    );
    expect(early).toMatchObject({ ok: false, error: "not-your-turn" });

    const turn = await getDraftTurn(draftId);
    expect(turn?.pickNumber).toBe(5);
    expect(turn?.captainUserId).toBe(captains[3]!.id);
  });

  it("blocks non-captains and organizers", async () => {
    const { organizer, draftId, captains } = await makeStartedDraft("p-forbidden");
    const player = await makeEligiblePlayer("p-forbidden-pool");
    const rando = await makeUser("p-forbidden-rando", "player");

    expect(await makePick(rando, draftId, player.profileId)).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(await makePick(organizer, draftId, player.profileId)).toMatchObject({
      ok: false,
      error: "forbidden",
    });

    // The rejected attempts must not have consumed the turn.
    const ok = await makePick(captains[0]!, draftId, player.profileId);
    expect(ok.ok).toBe(true);
  });

  it("rejects ineligible, unprofiled, and already-drafted players", async () => {
    const { draftId, captains } = await makeStartedDraft("p-elig");
    const approver = await makeUser("p-elig-approver");

    // Approved but NOT draft-eligible.
    const inactiveEmail = newEmail("p-elig-inactive");
    await signUpTestUser(inactiveEmail);
    const [inactive] = await db
      .select()
      .from(users)
      .where(eq(users.email, inactiveEmail))
      .limit(1);
    const submitted = await submitProfile(inactive!.id, {
      ...profileBase,
      displayName: "Not Eligible",
    });
    if (!submitted.ok) throw new Error("setup failed");
    await approveProfile(approver, submitted.profile.id);
    expect(await makePick(captains[0]!, draftId, submitted.profile.id)).toMatchObject({
      ok: false,
      error: "not-eligible",
    });

    // No profile at all.
    const bare = await makeUser("p-elig-bare", "player");
    expect(await makePick(captains[0]!, draftId, bare.id)).toMatchObject({
      ok: false,
      error: "not-eligible",
    });

    // Already drafted (active pick) — the next captain cannot take them.
    const taken = await makeEligiblePlayer("p-elig-taken");
    expect((await makePick(captains[0]!, draftId, taken.profileId)).ok).toBe(true);
    expect(await makePick(captains[1]!, draftId, taken.profileId)).toMatchObject({
      ok: false,
      error: "already-drafted",
    });

    // Unknown player id.
    expect(
      await makePick(captains[1]!, draftId, "00000000-0000-4000-8000-000000000000"),
    ).toMatchObject({ ok: false, error: "not-found" });
  });

  it("rejects picks while paused or outside an active draft", async () => {
    const { organizer, draftId, captains } = await makeStartedDraft("p-gate");
    const player = await makeEligiblePlayer("p-gate-pool");

    await pauseDraft(organizer, draftId);
    expect(await makePick(captains[0]!, draftId, player.profileId)).toMatchObject({
      ok: false,
      error: "draft-paused",
    });

    await resumeDraft(organizer, draftId);
    await completeDraft(organizer, draftId);
    expect(await makePick(captains[0]!, draftId, player.profileId)).toMatchObject({
      ok: false,
      error: "invalid-state",
    });

    expect(
      await makePick(captains[0]!, "00000000-0000-4000-8000-000000000000", player.profileId),
    ).toMatchObject({ ok: false, error: "not-found" });
  });

  it("auto-completes the draft on the final pick", async () => {
    const { draftId, captains } = await makeStartedDraft("p-final", 1);

    for (let i = 0; i < 4; i++) {
      const player = await makeEligiblePlayer(`p-final-p${i + 1}`);
      const r = await makePick(captains[i]!, draftId, player.profileId);
      expect(r.ok).toBe(true);
    }

    const [draft] = await db
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    expect(draft?.status).toBe("completed");
    expect(draft?.completedAt).toBeInstanceOf(Date);
  });

  it("is idempotent for retried picks with the same key", async () => {
    const { draftId, captains } = await makeStartedDraft("p-idem");
    const player = await makeEligiblePlayer("p-idem-pool");

    const first = await makePick(captains[0]!, draftId, player.profileId, {
      idempotencyKey: "retry-1",
    });
    expect(first.ok).toBe(true);

    const replay = await makePick(captains[0]!, draftId, player.profileId, {
      idempotencyKey: "retry-1",
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok || !first.ok) return;
    expect(replay.pick.id).toBe(first.pick.id);
    expect(replay.replayed).toBe(true);

    // Only one row; the cursor advanced exactly once.
    const picks = await activePicks(draftId);
    expect(picks).toHaveLength(1);
    const turn = await getDraftTurn(draftId);
    expect(turn?.pickNumber).toBe(2);
  });

  it("undoes the last pick: soft reversal, cursor rewind, player freed", async () => {
    const { organizer, draftId, captains } = await makeStartedDraft("p-undo");
    const player = await makeEligiblePlayer("p-undo-pool");

    const picked = await makePick(captains[0]!, draftId, player.profileId);
    expect(picked.ok).toBe(true);

    // A captain cannot undo.
    expect(await undoPick(captains[0]!, draftId, "no")).toMatchObject({
      ok: false,
      error: "forbidden",
    });

    const undone = await undoPick(organizer, draftId, "Wrong player");
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.pick.undoneAt).toBeInstanceOf(Date);
    expect(undone.pick.undoReason).toBe("Wrong player");
    expect(undone.pick.undoneByUserId).toBe(organizer.id);

    // Soft reversal: the row survives.
    const all = await listPicks(draftId);
    expect(all).toHaveLength(1);
    expect(all[0]!.undoneAt).toBeInstanceOf(Date);
    expect(await activePicks(draftId)).toHaveLength(0);

    // Cursor rewound; the freed player can be re-drafted.
    const turn = await getDraftTurn(draftId);
    expect(turn?.pickNumber).toBe(1);
    const again = await makePick(captains[0]!, draftId, player.profileId);
    expect(again.ok).toBe(true);

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, draftId));
    expect(events.filter((e) => e.action === "draft.pick_undone")).toHaveLength(1);
  });

  it("refuses to undo when there is no pick to undo", async () => {
    const { organizer, draftId } = await makeStartedDraft("p-undo-none");
    const none = await undoPick(organizer, draftId, "nothing");
    expect(none).toMatchObject({ ok: false, error: "invalid-state" });
  });

  it("concurrent identical pick requests: exactly one succeeds", async () => {
    const { draftId, captains } = await makeStartedDraft("p-race");
    const player = await makeEligiblePlayer("p-race-pool");

    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => makePick(captains[0]!, draftId, player.profileId)),
    );

    const winners = attempts.filter((a) => a.ok);
    expect(winners).toHaveLength(1);

    const picks = await activePicks(draftId);
    expect(picks).toHaveLength(1);

    const turn = await getDraftTurn(draftId);
    expect(turn?.pickNumber).toBe(2);
  });
});

describe("picks HTTP layer", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  function pickRequest(
    draftId: string,
    headers: Headers,
    body: Record<string, unknown>,
  ): Request {
    return new Request(`http://localhost/api/drafts/${draftId}/picks`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  const routeCtx = (draftId: string) => ({
    params: Promise.resolve({ draftId }),
  });

  it("returns 201 for the on-turn captain and 409 for a stale turn", async () => {
    // Four real session users become the captains, in order. Captains must
    // hold approved profiles to be assignable.
    const approver = await makeUser("http-approver");
    const captainSessions = [];
    for (let i = 1; i <= 4; i++) {
      const session = await makeSessionUser(`http-c${i}`, "captain");
      const submitted = await submitProfile(session.actor.id, {
        ...profileBase,
        displayName: `Captain ${i}`,
      });
      if (!submitted.ok) throw new Error("setup failed");
      await approveProfile(approver, submitted.profile.id);
      captainSessions.push(session);
    }
    const { draftId } = await makeStartedDraft(
      "http-basic",
      8,
      captainSessions.map((s) => s.actor),
    );
    const player = await makeEligiblePlayer("http-basic-pool");

    // The order-2 captain submits first — stale turn.
    const stale = await postPick(
      pickRequest(draftId, captainSessions[1]!.headers, { playerId: player.profileId }),
      routeCtx(draftId),
    );
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as { error?: string };
    expect(staleBody.error).toBe("not-your-turn");

    // The on-turn (order-1) captain succeeds.
    const ok = await postPick(
      pickRequest(draftId, captainSessions[0]!.headers, {
        playerId: player.profileId,
        idempotencyKey: "http-retry",
      }),
      routeCtx(draftId),
    );
    expect(ok.status).toBe(201);
    const okBody = (await ok.json()) as { pick: { pickNumber: number } };
    expect(okBody.pick.pickNumber).toBe(1);

    // Same captain retrying with the same idempotency key gets 200 + replay.
    const replay = await postPick(
      pickRequest(draftId, captainSessions[0]!.headers, {
        playerId: player.profileId,
        idempotencyKey: "http-retry",
      }),
      routeCtx(draftId),
    );
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { replayed: boolean };
    expect(replayBody.replayed).toBe(true);
  });

  it("returns 401 anonymous, 403 wrong role, 400 malformed, 404 unknown", async () => {
    const { draftId } = await makeStartedDraft("http-bad");
    const { actor, headers } = await makeSessionUser("http-rando", "player");
    void actor;

    const anon = await postPick(
      pickRequest(draftId, new Headers(), { playerId: "x" }),
      routeCtx(draftId),
    );
    expect(anon.status).toBe(401);

    const wrongRole = await postPick(
      pickRequest(draftId, headers, {
        playerId: "00000000-0000-4000-8000-000000000000",
      }),
      routeCtx(draftId),
    );
    expect(wrongRole.status).toBe(403);

    const { headers: captainHeaders } = await makeSessionUser(
      "http-bad-c",
      "captain",
    );
    const malformed = await postPick(
      pickRequest(draftId, captainHeaders, { playerId: "not-a-uuid" }),
      routeCtx(draftId),
    );
    expect(malformed.status).toBe(400);

    const ghostDraft = "00000000-0000-4000-8000-000000000000";
    const ghost = await postPick(
      pickRequest(ghostDraft, captainHeaders, {
        playerId: "00000000-0000-4000-8000-000000000000",
      }),
      routeCtx(ghostDraft),
    );
    expect(ghost.status).toBe(404);
  });
});


