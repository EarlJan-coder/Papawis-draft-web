import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, playerProfiles, users } from "@/db/schema";
import {
  approveProfile,
  listApprovedProfiles,
  listPendingProfiles,
  rejectProfile,
  setDraftEligibility,
  type Actor,
} from "@/features/approvals/approval-service";
import { submitProfile } from "@/features/profiles/profile-service";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * Organizer approval queue (Phase 3).
 * The break these catch: a decision made by the wrong role, a player
 * approving their own profile, an illegal status transition, a rejection
 * without a reason, or raw email/DOB leaking into the queue payload.
 */

const profile = {
  displayName: "Aaliyah Brooks",
  positions: ["SG"],
  dateOfBirth: "2000-06-15",
  heightCm: 183,
  skillLevel: "advanced",
};

async function makeUser(
  prefix: string,
  role: "player" | "organizer" = "player",
): Promise<Actor> {
  const email = newEmail(prefix);
  await signUpTestUser(email);
  if (role === "organizer") {
    await db.update(users).set({ role }).where(eq(users.email, email));
  }
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!row) throw new Error("test user missing");
  return { id: row.id, role: row.role };
}

async function makePendingProfile(prefix: string) {
  const player = await makeUser(prefix);
  const result = await submitProfile(player.id, profile);
  if (!result.ok) throw new Error("setup failed");
  return { player, profileId: result.profile.id };
}

describe("approval service", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it("lists pending profiles with masked email and derived age, no raw DOB", async () => {
    const email = newEmail("queue");
    await signUpTestUser(email);
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    await submitProfile(user!.id, profile);

    const pending = await listPendingProfiles();
    // Local part "queue-…" is long, so the mask is first char + "***".
    const entry = pending.find((p) => p.emailMasked === `${email[0]}***@example.com`);
    expect(entry).toBeDefined();
    expect(entry!.emailMasked).not.toContain(email);
    expect(entry!.emailMasked.endsWith("@example.com")).toBe(true);
    expect(entry!.ageYears).toBeTypeOf("number");
    expect(entry!).not.toHaveProperty("dateOfBirth");
    expect(entry!.displayName).toBe("Aaliyah Brooks");
  });

  it("approving moves a pending profile to approved and audits it", async () => {
    const organizer = await makeUser("approve", "organizer");
    const { profileId } = await makePendingProfile("approve");

    const result = await approveProfile(organizer, profileId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.profileStatus).toBe("approved");

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, profileId));
    expect(events.filter((e) => e.action === "player_profile.approved")).toHaveLength(1);
  });

  it("rejecting stores the reason and audits it", async () => {
    const organizer = await makeUser("reject", "organizer");
    const { profileId } = await makePendingProfile("reject");

    const result = await rejectProfile(organizer, profileId, "Height unverified");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.profileStatus).toBe("rejected");
    expect(result.profile.statusReason).toBe("Height unverified");

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, profileId));
    const rejectEvents = events.filter((e) => e.action === "player_profile.rejected");
    expect(rejectEvents).toHaveLength(1);
    expect(rejectEvents[0]?.metadata).toMatchObject({ reason: "Height unverified" });
  });

  it("rejecting without a reason fails", async () => {
    const organizer = await makeUser("reject-nr", "organizer");
    const { profileId } = await makePendingProfile("reject-nr");

    const result = await rejectProfile(organizer, profileId, "   ");
    expect(result).toMatchObject({ ok: false, error: "reason-required" });

    const [row] = await db
      .select()
      .from(playerProfiles)
      .where(eq(playerProfiles.id, profileId))
      .limit(1);
    expect(row?.profileStatus).toBe("pending");
  });

  it("deciding twice on the same profile fails the second time", async () => {
    const organizer = await makeUser("decide-2x", "organizer");
    const { profileId } = await makePendingProfile("decide-2x");
    await approveProfile(organizer, profileId);

    const again = await rejectProfile(organizer, profileId, "Changed my mind");
    expect(again).toMatchObject({ ok: false, error: "invalid-state" });
  });

  it("players cannot approve", async () => {
    const player = await makeUser("no-approve");
    const { profileId } = await makePendingProfile("no-approve");

    const result = await approveProfile(player, profileId);
    expect(result).toMatchObject({ ok: false, error: "forbidden" });
  });

  it("an organizer cannot decide on their own profile", async () => {
    const organizer = await makeUser("self", "organizer");
    const own = await submitProfile(organizer.id, profile);
    if (!own.ok) throw new Error("setup failed");

    const approve = await approveProfile(organizer, own.profile.id);
    expect(approve).toMatchObject({ ok: false, error: "self-approval" });

    const reject = await rejectProfile(organizer, own.profile.id, "No");
    expect(reject).toMatchObject({ ok: false, error: "self-approval" });

    const [row] = await db
      .select()
      .from(playerProfiles)
      .where(eq(playerProfiles.id, own.profile.id))
      .limit(1);
    expect(row?.profileStatus).toBe("pending");
  });

  it("toggling eligibility works only on approved profiles and audits the change", async () => {
    const organizer = await makeUser("elig", "organizer");
    const { profileId } = await makePendingProfile("elig");

    const early = await setDraftEligibility(organizer, profileId, true);
    expect(early).toMatchObject({ ok: false, error: "invalid-state" });

    await approveProfile(organizer, profileId);
    const result = await setDraftEligibility(organizer, profileId, true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.isDraftEligible).toBe(true);

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, profileId));
    expect(
      events.filter((e) => e.action === "player_profile.eligibility_changed"),
    ).toHaveLength(1);
  });

  it("lists approved profiles with their eligibility flag, excluding others", async () => {
    const organizer = await makeUser("approved-list", "organizer");
    const { profileId } = await makePendingProfile("approved-list");
    const approved = await approveProfile(organizer, profileId);
    expect(approved.ok).toBe(true);

    const rows = await listApprovedProfiles();
    const entry = rows.find((r) => r.id === profileId);
    expect(entry).toBeDefined();
    expect(entry!.isDraftEligible).toBe(false);
    expect(entry!.displayName).toBe("Aaliyah Brooks");
    expect(entry!.emailMasked).toBe("a***@example.com");

    // A still-pending profile must not appear.
    const { profileId: pendingId } = await makePendingProfile("approved-list-2");
    const after = await listApprovedProfiles();
    expect(after.some((r) => r.id === pendingId)).toBe(false);
  });

  it("deciding on an unknown profile fails cleanly", async () => {
    const organizer = await makeUser("ghost", "organizer");

    const result = await approveProfile(organizer, "00000000-0000-4000-8000-000000000000");
    expect(result).toMatchObject({ ok: false, error: "not-found" });
  });
});
