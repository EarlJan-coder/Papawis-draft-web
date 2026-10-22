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
import { makeStartedDraft } from "../setup/draft-fixtures";
import { POST as postPick } from "@/app/api/drafts/[draftId]/picks/route";
import { enforceRateLimit, PICK_RATE_LIMIT } from "@/lib/rate-limit";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * Rate limiting (Phase 8 security pass). The break these catch: a shared
 * counter that leaks across keys, a window that never resets, or the picks
 * POST endpoint letting an authenticated captain hammer mutations past the
 * fixed budget (auth routes are already covered by Better Auth's own
 * database-backed limiter).
 */

const profileBase = {
  positions: ["PG"] as string[],
  dateOfBirth: "1997-07-01",
  heightCm: 181,
  skillLevel: "intermediate" as const,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("enforceRateLimit", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("allows up to max within a window, then rejects with a retry hint", async () => {
    const rule = { windowMs: 400, max: 3 };

    for (let i = 1; i <= rule.max; i++) {
      expect((await enforceRateLimit("test:alpha", rule)).ok).toBe(true);
    }

    const rejected = await enforceRateLimit("test:alpha", rule);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.retryAfterSec).toBeGreaterThan(0);

    // The window rolls over and the key is usable again.
    await sleep(rule.windowMs + 50);
    expect((await enforceRateLimit("test:alpha", rule)).ok).toBe(true);
  });

  it("keeps counters isolated per key", async () => {
    const rule = { windowMs: 400, max: 1 };
    expect((await enforceRateLimit("test:one", rule)).ok).toBe(true);
    expect((await enforceRateLimit("test:one", rule)).ok).toBe(false);
    // A different subject is unaffected by the exhausted one.
    expect((await enforceRateLimit("test:two", rule)).ok).toBe(true);
  });

  it("counts a parallel burst atomically — exactly max get through", async () => {
    // The upsert must serialize concurrent increments: no lost updates
    // (over-admission) and no false rejections inside the budget.
    const rule = { windowMs: 10_000, max: 15 };
    const decisions = await Promise.all(
      Array.from({ length: rule.max + 5 }, () =>
        enforceRateLimit("test:burst", rule),
      ),
    );
    const allowed = decisions.filter((d) => d.ok).length;
    expect(allowed).toBe(rule.max);
  });
});

describe("picks POST rate limit", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /** An approved + eligible captain, WITH their session-cookie headers. */
  async function makeCaptain(
    prefix: string,
  ): Promise<Actor & { profileId: string; headers: Headers }> {
    const approverEmail = newEmail(`${prefix}-approver`);
    await signUpTestUser(approverEmail);
    await db
      .update(users)
      .set({ role: "organizer" })
      .where(eq(users.email, approverEmail));
    const [approver] = await db
      .select()
      .from(users)
      .where(eq(users.email, approverEmail))
      .limit(1);
    if (!approver) throw new Error("test user missing");

    const email = newEmail(prefix);
    const headers = await signUpTestUser(email);
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row) throw new Error("test user missing");

    const submitted = await submitProfile(row.id, {
      ...profileBase,
      displayName: `Captain ${prefix}`,
    });
    if (!submitted.ok) throw new Error("setup failed");
    await approveProfile({ id: approver.id, role: "organizer" }, submitted.profile.id);
    await setDraftEligibility(
      { id: approver.id, role: "organizer" },
      submitted.profile.id,
      true,
    );
    await db.update(users).set({ role: "captain" }).where(eq(users.email, email));

    return {
      id: row.id,
      role: "captain",
      profileId: submitted.profile.id,
      headers,
    };
  }

  it("returns 429 once a captain exceeds the pick request budget", async () => {
    const captain = await makeCaptain("rl-c1");
    const captains = [
      captain,
      await makeCaptain("rl-c2"),
      await makeCaptain("rl-c3"),
      await makeCaptain("rl-c4"),
    ];
    const { draftId } = await makeStartedDraft("rl", 4, captains);

    const request = () =>
      new Request(`http://localhost/api/drafts/${draftId}/picks`, {
        method: "POST",
        headers: captain.headers,
        body: JSON.stringify({ playerId: "00000000-0000-4000-8000-000000000000" }),
      });
    const routeCtx = { params: Promise.resolve({ draftId }) };

    // Requests inside the budget reach auth/state handling — never 429.
    for (let i = 0; i < PICK_RATE_LIMIT.max; i++) {
      const response = await postPick(request(), routeCtx);
      expect(response.status).not.toBe(429);
    }

    // The request past the budget is refused before touching draft state.
    const limited = await postPick(request(), routeCtx);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    const body = (await limited.json()) as { error?: string };
    expect(body.error).toBe("rate-limited");
  });
});
