import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  draftPicks,
  draftTeamAssignments,
  drafts,
  users,
} from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";
import { getTeamRosters } from "@/features/drafts/board-service";
import { getDraftById } from "@/features/drafts/draft-service";
import { getLeagueName } from "@/lib/config";
import { maskEmail } from "@/lib/utils";

/**
 * Audit history + roster publication (Phase 7).
 *
 * Publication is a server gate, not a UI toggle: a draft can be published
 * exactly once, only by an organizer, only after it is completed with every
 * pick made. `getPublishedRosters` is the public read surface — it serves a
 * strictly whitelisted payload (names, positions, height, skill) and never
 * internal ids or contact details. `listAuditEntries` exposes the audit
 * trail to organizers only, with actor emails masked.
 */

export type PublicationErrorCode =
  | "forbidden"
  | "not-found"
  | "invalid-state"
  | "already-published";

export type PublicationResult =
  | { ok: true; draft: typeof drafts.$inferSelect }
  | { ok: false; error: PublicationErrorCode; message: string };

export type PublishedPlayer = {
  displayName: string;
  positions: string[];
  heightCm: number | null;
  skillLevel: string | null;
};

export type PublishedTeam = {
  teamName: string;
  captainName: string | null;
  players: PublishedPlayer[];
};

export type PublishedRosters = {
  leagueName: string;
  publishedAt: Date;
  totalPicks: number;
  teams: PublishedTeam[];
};

export type AuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  actorName: string | null;
  actorEmail: string | null;
};

export type AuditListResult =
  | { ok: true; entries: AuditEntry[] }
  | { ok: false; error: "forbidden"; message: string };

// ---------------------------------------------------------------------------
// Publication (write)
// ---------------------------------------------------------------------------

export async function publishDraft(
  actor: Actor,
  draftId: string,
): Promise<PublicationResult> {
  if (actor.role !== "organizer") return forbiddenPublish();

  const draft = await getDraftById(draftId);
  if (!draft) return notFoundPublish();
  if (draft.publishedAt) return alreadyPublished();

  if (draft.status !== "completed") {
    return invalidState("Only a completed draft can be published.");
  }

  // Defense in depth: a draft can be completed early (manual completion),
  // so verify every configured pick actually exists (active picks only —
  // an undone row no longer counts toward the roster) before going public.
  const [pickRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(draftPicks)
    .where(and(eq(draftPicks.draftId, draftId), isNull(draftPicks.undoneAt)));
  const [assignmentRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(draftTeamAssignments)
    .where(eq(draftTeamAssignments.draftId, draftId));
  const expected = draft.totalRounds * (assignmentRow?.count ?? 0);
  if ((pickRow?.count ?? 0) !== expected) {
    return invalidState("Every pick must be made before publication.");
  }

  // Atomic one-shot stamp: the `publishedAt is null` guard makes a
  // concurrent second publish lose the race and see already-published.
  const [updated] = await db
    .update(drafts)
    .set({ publishedAt: new Date() })
    .where(and(eq(drafts.id, draftId), isNull(drafts.publishedAt)))
    .returning();
  if (!updated) return alreadyPublished();

  await db.insert(auditLogs).values({
    actorUserId: actor.id,
    action: "draft.published",
    entityType: "draft",
    entityId: draftId,
    metadata: { totalPicks: expected },
  });

  return { ok: true, draft: updated };
}

// ---------------------------------------------------------------------------
// Public read surface
// ---------------------------------------------------------------------------

/**
 * The latest published draft's rosters, or null when nothing has been
 * published. Newer unpublished drafts do not hide an existing publication.
 */
export async function getPublishedRosters(): Promise<PublishedRosters | null> {
  const [published] = await db
    .select()
    .from(drafts)
    .where(isNotNull(drafts.publishedAt))
    .orderBy(desc(drafts.publishedAt))
    .limit(1);
  if (!published?.publishedAt) return null;

  const rosters = await getTeamRosters(published.id);
  const teams: PublishedTeam[] = rosters.map((r) => ({
    teamName: r.teamName,
    captainName: r.captainName,
    players: r.players.map((p) => ({
      displayName: p.displayName,
      positions: p.positions,
      heightCm: p.heightCm,
      skillLevel: p.skillLevel,
    })),
  }));

  return {
    leagueName: getLeagueName(),
    publishedAt: published.publishedAt,
    totalPicks: teams.reduce((sum, t) => sum + t.players.length, 0),
    teams,
  };
}

// ---------------------------------------------------------------------------
// Audit history (organizer read)
// ---------------------------------------------------------------------------

export const DEFAULT_AUDIT_LIMIT = 50;
export const MAX_AUDIT_LIMIT = 100;

/** Newest-first audit entries for organizers, actor emails masked. */
export async function listAuditEntries(
  actor: Actor,
  limit: number = DEFAULT_AUDIT_LIMIT,
): Promise<AuditListResult> {
  if (actor.role !== "organizer") {
    return {
      ok: false,
      error: "forbidden",
      message: "You do not have permission to perform this action.",
    };
  }

  const capped = Math.min(
    MAX_AUDIT_LIMIT,
    Math.max(1, Math.floor(limit)),
  );

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(capped);

  return {
    ok: true,
    entries: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      metadata: r.metadata ?? {},
      createdAt: r.createdAt,
      actorName: r.actorName || null,
      actorEmail: r.actorEmail ? maskEmail(r.actorEmail) : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

function forbiddenPublish(): PublicationResult {
  return {
    ok: false,
    error: "forbidden",
    message: "You do not have permission to perform this action.",
  };
}

function notFoundPublish(): PublicationResult {
  return {
    ok: false,
    error: "not-found",
    message: "No draft found with that id.",
  };
}

function invalidState(message: string): PublicationResult {
  return { ok: false, error: "invalid-state", message };
}

function alreadyPublished(): PublicationResult {
  return {
    ok: false,
    error: "already-published",
    message: "This draft has already been published.",
  };
}
