import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import {
  completeDraft,
  createDraft,
  pauseDraft,
  resumeDraft,
} from "@/features/drafts/draft-service";
import { makePick, undoPick } from "@/features/drafts/pick-service";
import {
  getPublishedRosters,
  listAuditEntries,
  publishDraft,
} from "@/features/publications/publication-service";
import { getLeagueName } from "@/lib/config";
import { maskEmail } from "@/lib/utils";
import { resetDatabase } from "../setup/db";
import {
  fillAllPicks,
  fillPickRange,
  makeEligiblePlayer,
  makeStartedDraft,
  makeUser,
} from "../setup/draft-fixtures";

/**
 * Audit history + roster publication (Phase 7).
 * The break these catch: publishing before every pick is in, publishing
 * twice, a non-organizer publishing or reading the audit trail, and — the
 * big one — the public payload leaking private data (ids, emails, draft
 * internals) or showing rosters for a draft nobody published.
 */

describe("draft publication", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("refuses publication for non-organizers and unfinished drafts", async () => {
    const { organizer, draftId } = await makeStartedDraft("pub-gate", 2);
    const rando = await makeUser("pub-gate-rando", "player");

    expect(await publishDraft(rando, draftId)).toMatchObject({
      ok: false,
      error: "forbidden",
    });

    // Active draft, zero picks made — not publishable.
    expect(await publishDraft(organizer, draftId)).toMatchObject({
      ok: false,
      error: "invalid-state",
    });

    expect(
      await publishDraft(organizer, "00000000-0000-4000-8000-000000000000"),
    ).toMatchObject({ ok: false, error: "not-found" });

    // Nothing is public until an organizer actually publishes.
    expect(await getPublishedRosters()).toBeNull();
  });

  it("blocks publishing a completed draft that is missing picks", async () => {
    const { organizer, draftId, captains } = await makeStartedDraft("pub-short", 2);

    // Only two of the eight required picks are made.
    await fillPickRange("pub-short", draftId, captains, 1, 2);
    expect((await completeDraft(organizer, draftId)).ok).toBe(true);

    // Completed on paper, but six picks are missing — still not publishable.
    expect(await publishDraft(organizer, draftId)).toMatchObject({
      ok: false,
      error: "invalid-state",
    });
    expect(await getPublishedRosters()).toBeNull();
  });

  it("publishes a fully drafted completed audit trail and serves a whitelisted payload", async () => {
    const { organizer, draftId, captains } = await makeStartedDraft("pub-full", 2);

    await fillAllPicks("pub-full", draftId, captains, 2);

    const published = await publishDraft(organizer, draftId);
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.draft.publishedAt).toBeInstanceOf(Date);

    // Publication is recorded in the audit trail.
    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, draftId));
    const publishEvents = events.filter((e) => e.action === "draft.published");
    expect(publishEvents).toHaveLength(1);
    expect(publishEvents[0]!.actorUserId).toBe(organizer.id);

    // Double-publishing is rejected without touching the original stamp.
    expect(await publishDraft(organizer, draftId)).toMatchObject({
      ok: false,
      error: "already-published",
    });

    const payload = await getPublishedRosters();
    expect(payload).not.toBeNull();
    if (!payload) return;

    // Exactly the whitelisted shape — nothing private at the top level.
    expect(Object.keys(payload).sort()).toEqual([
      "leagueName",
      "publishedAt",
      "teams",
      "totalPicks",
    ]);
    expect(payload.leagueName).toBe(getLeagueName());
    expect(payload.publishedAt).toBeInstanceOf(Date);
    expect(payload.totalPicks).toBe(8);
    expect(payload.teams).toHaveLength(4);

    const players = payload.teams.flatMap((t) => t.players);
    expect(players).toHaveLength(8);
    for (const team of payload.teams) {
      expect(Object.keys(team).sort()).toEqual([
        "captainName",
        "players",
        "teamName",
      ]);
      for (const player of team.players) {
        expect(Object.keys(player).sort()).toEqual([
          "displayName",
          "heightCm",
          "positions",
          "skillLevel",
        ]);
      }
    }

    // No ids, no emails, no draft internals anywhere in the JSON.
    const json = JSON.stringify(payload);
    expect(json).not.toContain("@");
    expect(json).not.toContain(draftId);
    expect(json).not.toContain(organizer.id);

    // Stable across reads (same publication, no hidden state drift).
    const again = await getPublishedRosters();
    expect(again).toEqual(payload);
  });

  it("keeps serving the published rosters after a new draft is created", async () => {
    const { organizer, draftId, captains } = await makeStartedDraft("pub-keep", 2);
    await fillAllPicks("pub-keep", draftId, captains, 2);
    expect((await publishDraft(organizer, draftId)).ok).toBe(true);

    // A fresh setup-phase draft appears — the old publication still stands.
    const next = await createDraft(organizer, { totalRounds: 4 });
    expect(next.ok).toBe(true);

    const payload = await getPublishedRosters();
    expect(payload).not.toBeNull();
    expect(payload?.totalPicks).toBe(8);
  });
});

describe("audit history", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lists newest-first, organizer-only, with masked actor emails", async () => {
    const { organizer, draftId, captains } = await makeStartedDraft("aud-flow", 2);

    // Build a varied trail: pick, pause, resume, undo, finish, publish.
    const first = await makePick(
      captains[0]!,
      draftId,
      (await makeEligiblePlayer("aud-flow-first")).profileId,
    );
    expect(first.ok).toBe(true);
    expect((await pauseDraft(organizer, draftId)).ok).toBe(true);
    expect((await resumeDraft(organizer, draftId)).ok).toBe(true);
    const undone = await undoPick(organizer, draftId, "Wrong player");
    expect(undone.ok).toBe(true);
    await fillAllPicks("aud-flow", draftId, captains, 2);
    expect((await publishDraft(organizer, draftId)).ok).toBe(true);

    const denied = await listAuditEntries(
      await makeUser("aud-rando", "player"),
      50,
    );
    expect(denied).toMatchObject({ ok: false, error: "forbidden" });

    const listed = await listAuditEntries(organizer, 50);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;

    const actions = listed.entries.map((e) => e.action);
    expect(actions[0]).toBe("draft.published");
    for (const expected of [
      "draft.pick_made",
      "draft.paused",
      "draft.resumed",
      "draft.pick_undone",
      "draft.completed",
      "draft.published",
    ]) {
      expect(actions).toContain(expected);
    }

    // Newest-first ordering.
    for (let i = 1; i < listed.entries.length; i++) {
      expect(listed.entries[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
        listed.entries[i]!.createdAt.getTime(),
      );
    }

    // Actor identity is present but the email is masked.
    const publishEntry = listed.entries[0]!;
    expect(publishEntry.actorName).toBe("Test User");
    expect(publishEntry.actorEmail).toBe(maskEmail(organizer.email));
    expect(publishEntry.actorEmail).toContain("***");

    // The limit parameter is respected.
    const capped = await listAuditEntries(organizer, 3);
    expect(capped.ok).toBe(true);
    if (!capped.ok) return;
    expect(capped.entries).toHaveLength(3);
    expect(capped.entries[0]!.action).toBe("draft.published");
  });
});
