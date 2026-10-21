import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, playerProfiles, users } from "@/db/schema";
import { computeAgeYears } from "@/features/profiles/validation";
import { maskEmail } from "@/lib/utils";

/**
 * Organizer review of player profiles (Phase 3).
 *
 * Authorization lives here, not in the UI: every decision re-checks the
 * actor's role server-side. An organizer may never decide on their own
 * profile (self-approval), rejections require a reason, and only pending
 * profiles can be approved or rejected. The queue payload exposes a masked
 * email and a derived age — never the raw email or date of birth.
 */

export type Actor = {
  id: string;
  role: "player" | "captain" | "organizer";
};

export type PendingProfileSummary = {
  id: string;
  displayName: string;
  positions: string[];
  heightCm: number | null;
  skillLevel: string | null;
  experience: string | null;
  bio: string | null;
  emailMasked: string;
  ageYears: number | null;
  submittedAt: Date;
};

/** Approved profiles for the organizer's eligibility toggles. */
export async function listApprovedProfiles(): Promise<ApprovedProfileSummary[]> {
  const rows = await db
    .select({ profile: playerProfiles, email: users.email })
    .from(playerProfiles)
    .innerJoin(users, eq(playerProfiles.userId, users.id))
    .where(eq(playerProfiles.profileStatus, "approved"))
    .orderBy(asc(playerProfiles.displayName));

  return rows.map(({ profile, email }) => ({
    id: profile.id,
    displayName: profile.displayName,
    positions: profile.positions,
    isDraftEligible: profile.isDraftEligible,
    emailMasked: maskEmail(email),
    ageYears: profile.dateOfBirth ? computeAgeYears(profile.dateOfBirth) : null,
  }));
}

export type ApprovedProfileSummary = {
  id: string;
  displayName: string;
  positions: string[];
  isDraftEligible: boolean;
  emailMasked: string;
  ageYears: number | null;
};

export type ApprovalResult =
  | { ok: true; profile: typeof playerProfiles.$inferSelect }
  | {
      ok: false;
      error:
        | "forbidden"
        | "self-approval"
        | "not-found"
        | "invalid-state"
        | "reason-required";
      message: string;
    };

/** Pending profiles for the organizer queue, oldest submission first. */
export async function listPendingProfiles(): Promise<PendingProfileSummary[]> {
  const rows = await db
    .select({ profile: playerProfiles, email: users.email })
    .from(playerProfiles)
    .innerJoin(users, eq(playerProfiles.userId, users.id))
    .where(eq(playerProfiles.profileStatus, "pending"))
    .orderBy(asc(playerProfiles.createdAt));

  return rows.map(({ profile, email }) => ({
    id: profile.id,
    displayName: profile.displayName,
    positions: profile.positions,
    heightCm: profile.heightCm,
    skillLevel: profile.skillLevel,
    experience: profile.experience,
    bio: profile.bio,
    emailMasked: maskEmail(email),
    ageYears: profile.dateOfBirth ? computeAgeYears(profile.dateOfBirth) : null,
    submittedAt: profile.createdAt,
  }));
}

export async function approveProfile(
  actor: Actor,
  profileId: string,
): Promise<ApprovalResult> {
  const decidable = await loadDecidableProfile(actor, profileId);
  if (!decidable.ok) return decidable.result;

  const [updated] = await db
    .update(playerProfiles)
    .set({ profileStatus: "approved", statusReason: null })
    .where(eq(playerProfiles.id, profileId))
    .returning();

  await writeDecisionAudit(actor.id, "player_profile.approved", profileId, {});

  return { ok: true, profile: updated };
}

export async function rejectProfile(
  actor: Actor,
  profileId: string,
  reason: string,
): Promise<ApprovalResult> {
  const decidable = await loadDecidableProfile(actor, profileId);
  if (!decidable.ok) return decidable.result;

  const trimmed = reason.trim();
  if (!trimmed) {
    return {
      ok: false,
      error: "reason-required",
      message: "A reason is required when rejecting a profile.",
    };
  }

  const [updated] = await db
    .update(playerProfiles)
    .set({ profileStatus: "rejected", statusReason: trimmed })
    .where(eq(playerProfiles.id, profileId))
    .returning();

  await writeDecisionAudit(actor.id, "player_profile.rejected", profileId, {
    reason: trimmed,
  });

  return { ok: true, profile: updated };
}

export async function setDraftEligibility(
  actor: Actor,
  profileId: string,
  eligible: boolean,
): Promise<ApprovalResult> {
  if (actor.role !== "organizer") {
    return forbiddenResult();
  }

  const [profile] = await db
    .select()
    .from(playerProfiles)
    .where(eq(playerProfiles.id, profileId))
    .limit(1);
  if (!profile) {
    return {
      ok: false,
      error: "not-found",
      message: "No player profile found with that id.",
    };
  }
  if (profile.profileStatus !== "approved") {
    return {
      ok: false,
      error: "invalid-state",
      message: "Only approved profiles can be marked draft-eligible.",
    };
  }

  const [updated] = await db
    .update(playerProfiles)
    .set({ isDraftEligible: eligible })
    .where(eq(playerProfiles.id, profileId))
    .returning();

  await writeDecisionAudit(actor.id, "player_profile.eligibility_changed", profileId, {
    eligible,
  });

  return { ok: true, profile: updated };
}

/** Shared authorization + state gate for approve/reject. */
async function loadDecidableProfile(
  actor: Actor,
  profileId: string,
): Promise<{ ok: true } | { ok: false; result: ApprovalResult }> {
  if (actor.role !== "organizer") {
    return { ok: false, result: forbiddenResult() };
  }

  const [profile] = await db
    .select()
    .from(playerProfiles)
    .where(eq(playerProfiles.id, profileId))
    .limit(1);
  if (!profile) {
    return {
      ok: false,
      result: {
        ok: false,
        error: "not-found",
        message: "No player profile found with that id.",
      },
    };
  }
  if (profile.userId === actor.id) {
    return {
      ok: false,
      result: {
        ok: false,
        error: "self-approval",
        message: "You cannot review your own player profile.",
      },
    };
  }
  if (profile.profileStatus !== "pending") {
    return {
      ok: false,
      result: {
        ok: false,
        error: "invalid-state",
        message: `Only pending profiles can be reviewed (this one is ${profile.profileStatus}).`,
      },
    };
  }
  return { ok: true };
}

function forbiddenResult(): ApprovalResult {
  return {
    ok: false,
    error: "forbidden",
    message: "You do not have permission to perform this action.",
  };
}

async function writeDecisionAudit(
  actorId: string,
  action: string,
  profileId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: actorId,
    action,
    entityType: "player_profile",
    entityId: profileId,
    metadata,
  });
}
