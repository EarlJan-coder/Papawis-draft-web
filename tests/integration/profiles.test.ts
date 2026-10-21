import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, playerProfiles, users } from "@/db/schema";
import {
  getProfileForUser,
  submitProfile,
  updateProfile,
} from "@/features/profiles/profile-service";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * Player profile lifecycle (Phase 3): submit while pending, edit before
 * approval, resubmit after rejection, locked after approval. Every write
 * audits. The break these catch: a status transition that should be
 * impossible, a missing audit event, or unvalidated input reaching the DB.
 */

const fullProfile = {
  displayName: "Aaliyah Brooks",
  positions: ["SG", "SF"],
  dateOfBirth: "2000-06-15",
  heightCm: 183,
  skillLevel: "advanced",
  experience: "3 seasons intramural",
  bio: "Two-way guard.",
};

async function userIdByEmail(email: string): Promise<string> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!row) throw new Error("test user missing");
  return row.id;
}

async function makeUser(prefix: string): Promise<string> {
  const email = newEmail(prefix);
  await signUpTestUser(email);
  return userIdByEmail(email);
}

describe("profile service", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it("submitProfile creates a pending profile and writes an audit event", async () => {
    const userId = await makeUser("profile-create");

    const result = await submitProfile(userId, fullProfile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.profileStatus).toBe("pending");
    expect(result.profile.isDraftEligible).toBe(false);
    expect(result.profile.userId).toBe(userId);

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, result.profile.id));
    expect(
      events.filter((e) => e.action === "player_profile.submitted"),
    ).toHaveLength(1);
  });

  it("submitProfile refuses a second profile for the same user", async () => {
    const userId = await makeUser("profile-dup");
    await submitProfile(userId, fullProfile);

    const second = await submitProfile(userId, fullProfile);
    expect(second).toMatchObject({ ok: false, error: "already-exists" });
  });

  it("submitProfile rejects invalid input without touching the database", async () => {
    const userId = await makeUser("profile-invalid");

    const result = await submitProfile(userId, {
      ...fullProfile,
      positions: ["PG", "XX"],
    });
    expect(result).toMatchObject({ ok: false, error: "invalid-input" });

    const profiles = await getProfileForUser(userId);
    expect(profiles.profile).toBeNull();
  });

  it("updateProfile edits fields while the profile is pending", async () => {
    const userId = await makeUser("profile-edit");
    const created = await submitProfile(userId, fullProfile);
    if (!created.ok) throw new Error("setup failed");

    const result = await updateProfile(userId, {
      ...fullProfile,
      heightCm: 188,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.heightCm).toBe(188);
    expect(result.profile.profileStatus).toBe("pending");
  });

  it("updateProfile resubmits a rejected profile back to pending", async () => {
    const userId = await makeUser("profile-resubmit");
    const created = await submitProfile(userId, fullProfile);
    if (!created.ok) throw new Error("setup failed");
    await db
      .update(playerProfiles)
      .set({ profileStatus: "rejected", statusReason: "Height unverified" })
      .where(eq(playerProfiles.id, created.profile.id));

    const result = await updateProfile(userId, fullProfile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.profileStatus).toBe("pending");
    expect(result.profile.statusReason).toBeNull();
  });

  it("updateProfile refuses to edit an approved profile", async () => {
    const userId = await makeUser("profile-locked");
    const created = await submitProfile(userId, fullProfile);
    if (!created.ok) throw new Error("setup failed");
    await db
      .update(playerProfiles)
      .set({ profileStatus: "approved" })
      .where(eq(playerProfiles.id, created.profile.id));

    const result = await updateProfile(userId, {
      ...fullProfile,
      heightCm: 150,
    });
    expect(result).toMatchObject({ ok: false, error: "profile-locked" });
  });

  it("updateProfile fails cleanly when the user has no profile", async () => {
    const userId = await makeUser("profile-nope");

    const result = await updateProfile(userId, fullProfile);
    expect(result).toMatchObject({ ok: false, error: "not-found" });
  });

  it("getProfileForUser reports null profile with zero completion", async () => {
    const userId = await makeUser("profile-none");

    const view = await getProfileForUser(userId);
    expect(view.profile).toBeNull();
    expect(view.completion).toBe(0);
    expect(view.ageYears).toBeNull();
  });

  it("getProfileForUser reports completion and derived age", async () => {
    const userId = await makeUser("profile-view");
    // DOB constructed so the expected age (20) is hand-derived, not read
    // from the production helper.
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 20);
    const isoDob = dob.toISOString().slice(0, 10);
    await submitProfile(userId, { ...fullProfile, dateOfBirth: isoDob });

    const view = await getProfileForUser(userId);
    expect(view.profile).not.toBeNull();
    expect(view.completion).toBe(100);
    expect(view.ageYears).toBe(20);
  });
});
