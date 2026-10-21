import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, playerProfiles } from "@/db/schema";
import {
  computeAgeYears,
  computeProfileCompletion,
  profileInputSchema,
  type ProfileInput,
} from "./validation";

/**
 * Player profile lifecycle (Phase 3).
 *
 * - One profile per user (DB-unique `user_id`).
 * - Submit creates it in `pending`; organizers review it (approval service).
 * - Edits are allowed while `pending` or `rejected` (rejection → fix →
 *   resubmit clears the reason); `approved` profiles are locked because the
 *   draft and published rosters are built on them.
 * - Every write appends an audit event.
 */

export type ProfileRow = typeof playerProfiles.$inferSelect;

export type ProfileMutationResult =
  | { ok: true; profile: ProfileRow }
  | {
      ok: false;
      error:
        | "invalid-input"
        | "already-exists"
        | "not-found"
        | "profile-locked";
      message: string;
      issues?: string[];
    };

export type ProfileView = {
  profile: ProfileRow | null;
  /** 0–100 completion across the seven profile fields. */
  completion: number;
  /** Derived from date of birth; the raw date never leaves this layer. */
  ageYears: number | null;
};

/** Read model for the player's own dashboard. */
export async function getProfileForUser(userId: string): Promise<ProfileView> {
  const [profile] = await db
    .select()
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);

  if (!profile) {
    return { profile: null, completion: 0, ageYears: null };
  }

  return {
    profile,
    completion: computeProfileCompletion(profile),
    ageYears: profile.dateOfBirth ? computeAgeYears(profile.dateOfBirth) : null,
  };
}

/** Create the user's profile (first submission). */
export async function submitProfile(
  userId: string,
  rawInput: unknown,
): Promise<ProfileMutationResult> {
  const parsed = parseInput(rawInput);
  if (!parsed.ok) return parsed.result;

  const [existing] = await db
    .select({ id: playerProfiles.id })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      error: "already-exists",
      message: "You already have a player profile. Edit it instead.",
    };
  }

  const [profile] = await db
    .insert(playerProfiles)
    .values({ userId, ...toRowValues(parsed.data) })
    .returning();

  await db.insert(auditLogs).values({
    actorUserId: userId,
    action: "player_profile.submitted",
    entityType: "player_profile",
    entityId: profile.id,
    metadata: { status: profile.profileStatus },
  });

  return { ok: true, profile };
}

/** Edit and resubmit the user's profile (pending/rejected only). */
export async function updateProfile(
  userId: string,
  rawInput: unknown,
): Promise<ProfileMutationResult> {
  const parsed = parseInput(rawInput);
  if (!parsed.ok) return parsed.result;

  const [profile] = await db
    .select()
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);
  if (!profile) {
    return {
      ok: false,
      error: "not-found",
      message: "No player profile found. Submit one first.",
    };
  }
  if (profile.profileStatus === "approved") {
    return {
      ok: false,
      error: "profile-locked",
      message:
        "Your profile was approved and can no longer be edited. Contact the organizer if something is wrong.",
    };
  }

  const [updated] = await db
    .update(playerProfiles)
    // Resubmitting returns the profile to the review queue and clears any
    // rejection reason; the audit trail keeps history.
    .set({
      ...toRowValues(parsed.data),
      profileStatus: "pending",
      statusReason: null,
    })
    .where(eq(playerProfiles.id, profile.id))
    .returning();

  await db.insert(auditLogs).values({
    actorUserId: userId,
    action: "player_profile.updated",
    entityType: "player_profile",
    entityId: updated.id,
    metadata: { status: updated.profileStatus },
  });

  return { ok: true, profile: updated };
}

function parseInput(
  rawInput: unknown,
): { ok: true; data: ProfileInput } | { ok: false; result: ProfileMutationResult } {
  const parsed = profileInputSchema.safeParse(rawInput);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    result: {
      ok: false,
      error: "invalid-input",
      message: "Please fix the highlighted fields.",
      issues: parsed.error.issues.map((issue) => issue.message),
    },
  };
}

function toRowValues(input: ProfileInput) {
  return {
    displayName: input.displayName,
    positions: input.positions,
    dateOfBirth: input.dateOfBirth ?? null,
    heightCm: input.heightCm ?? null,
    skillLevel: input.skillLevel ?? null,
    experience: input.experience || null,
    bio: input.bio || null,
  };
}
