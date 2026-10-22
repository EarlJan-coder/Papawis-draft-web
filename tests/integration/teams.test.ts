import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditLogs, teams, users } from "@/db/schema";
import type { Actor } from "@/features/approvals/approval-service";
import {
  createTeam,
  deleteTeam,
  listTeams,
  renameTeam,
} from "@/features/teams/team-service";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * League team management (Phase 4).
 * The break these catch: a fifth team sneaking in, duplicate names,
 * deleting a team that a draft assignment references (cascade would
 * silently destroy assignments/picks), or a non-organizer mutating teams.
 */

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

describe("team service", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates teams and lists them", async () => {
    const organizer = await makeUser("t-create");

    const result = await createTeam(organizer, "Raptors");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.team.name).toBe("Raptors");

    const rows = await listTeams();
    expect(rows.map((t) => t.name)).toContain("Raptors");
  });

  it("caps the league at exactly 4 teams", async () => {
    const organizer = await makeUser("t-limit");
    for (const name of ["Raptors", "Cobras", "Vipers", "Hawks"]) {
      const r = await createTeam(organizer, name);
      expect(r.ok).toBe(true);
    }
    const fifth = await createTeam(organizer, "Sharks");
    expect(fifth).toMatchObject({ ok: false, error: "team-limit" });

    const rows = await listTeams();
    expect(rows).toHaveLength(4);
  });

  it("rejects duplicate and blank names", async () => {
    const organizer = await makeUser("t-dup");
    await createTeam(organizer, "Hawks");

    const dup = await createTeam(organizer, "hawks"); // case-insensitive dup of Hawks
    expect(dup).toMatchObject({ ok: false, error: "duplicate-name" });

    const blank = await createTeam(organizer, "   ");
    expect(blank).toMatchObject({ ok: false, error: "invalid-name" });
  });

  it("renames a team but not onto a taken name", async () => {
    const organizer = await makeUser("t-rename");
    await createTeam(organizer, "Hawks");
    const created = await createTeam(organizer, "Wolves");
    if (!created.ok) throw new Error("setup failed");

    const renamed = await renameTeam(organizer, created.team.id, "Wildcats");
    expect(renamed.ok).toBe(true);

    const [row] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, created.team.id))
      .limit(1);
    expect(row?.name).toBe("Wildcats");

    const taken = await renameTeam(
      organizer,
      created.team.id,
      "hAwKs", // Hawks already exists in this test
    );
    expect(taken).toMatchObject({ ok: false, error: "duplicate-name" });
  });

  it("deletes a free team and audits it", async () => {
    const organizer = await makeUser("t-delete");
    const created = await createTeam(organizer, "Temp Squad");
    if (!created.ok) throw new Error("setup failed");

    const removed = await deleteTeam(organizer, created.team.id);
    expect(removed.ok).toBe(true);

    const rows = await listTeams();
    expect(rows.some((t) => t.id === created.team.id)).toBe(false);

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.team.id));
    expect(events.filter((e) => e.action === "team.deleted")).toHaveLength(1);
  });

  it("refuses to delete a team referenced by a draft assignment", async () => {
    const organizer = await makeUser("t-delete-guard");
    const created = await createTeam(organizer, "Anchored");
    if (!created.ok) throw new Error("setup failed");

    // Simulate a Phase-2 schema assignment row referencing the team.
    const { drafts, draftTeamAssignments } = await import("@/db/schema");
    const [draft] = await db.insert(drafts).values({}).returning();
    await db.insert(draftTeamAssignments).values({
      draftId: draft!.id,
      teamId: created.team.id,
      captainUserId: organizer.id,
      draftOrder: 1,
    });

    const removed = await deleteTeam(organizer, created.team.id);
    expect(removed).toMatchObject({ ok: false, error: "team-in-use" });

    const rows = await listTeams();
    expect(rows.some((t) => t.id === created.team.id)).toBe(true);
  });

  it("only an organizer may mutate teams", async () => {
    const player = await makeUser("t-forbidden", "player");
    const organizer = await makeUser("t-forbidden-org");
    const created = await createTeam(organizer, "Guarded");
    if (!created.ok) throw new Error("setup failed");

    expect(await createTeam(player, "Nope")).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(await renameTeam(player, created.team.id, "Hijacked")).toMatchObject({
      ok: false,
      error: "forbidden",
    });
    expect(await deleteTeam(player, created.team.id)).toMatchObject({
      ok: false,
      error: "forbidden",
    });
  });

  it("acting on an unknown team fails cleanly", async () => {
    const organizer = await makeUser("t-ghost");
    const ghost = "00000000-0000-4000-8000-000000000000";

    expect(await renameTeam(organizer, ghost, "X")).toMatchObject({
      ok: false,
      error: "not-found",
    });
    expect(await deleteTeam(organizer, ghost)).toMatchObject({
      ok: false,
      error: "not-found",
    });
  });
});
