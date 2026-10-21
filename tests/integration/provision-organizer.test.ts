import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { provisionOrganizer } from "@/features/admin/provision-organizer";
import { auditLogs, users } from "@/db/schema";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * Organizer provisioning: the only supported path to organizer privileges.
 * Covers the acceptance criterion "only controlled administrators can grant
 * organizer privileges".
 */
describe("provisionOrganizer", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it("promotes an existing player to organizer and writes an audit event", async () => {
    const email = newEmail("provision");

    await signUpTestUser(email);
    const [before] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    expect(before?.role).toBe("player");

    const result = await provisionOrganizer(email);
    expect(result).toEqual({ ok: true, status: "provisioned" });

    const [after] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    expect(after?.role).toBe("organizer");

    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, after?.id ?? ""));
    const provisionEvents = events.filter(
      (e) => e.action === "organizer.provisioned",
    );
    expect(provisionEvents).toHaveLength(1);
    expect(provisionEvents[0]?.metadata).toEqual({ previousRole: "player" });
  });

  it("is idempotent: re-running does not duplicate audit events", async () => {
    const email = newEmail("provision-idem");

    await signUpTestUser(email);
    await provisionOrganizer(email);
    const second = await provisionOrganizer(email);
    expect(second).toEqual({ ok: true, status: "already-organizer" });

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const events = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, row?.id ?? ""));
    expect(events.filter((e) => e.action === "organizer.provisioned")).toHaveLength(
      1,
    );
  });

  it("fails cleanly for unknown emails", async () => {
    const result = await provisionOrganizer("nobody-ever-registered@example.com");
    expect(result).toMatchObject({ ok: false, error: "user-not-found" });
  });

  it("refuses to convert captain accounts", async () => {
    const email = newEmail("captain-conflict");

    await signUpTestUser(email);
    await db
      .update(users)
      .set({ role: "captain" })
      .where(eq(users.email, email));

    const result = await provisionOrganizer(email);
    expect(result).toMatchObject({ ok: false, error: "captain-conflict" });

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    expect(row?.role).toBe("captain");
  });
});
