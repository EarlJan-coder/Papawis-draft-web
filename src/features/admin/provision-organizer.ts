import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";

/**
 * Controlled organizer provisioning — the ONLY supported way to grant
 * organizer privileges. No web endpoint ever changes a user's role.
 *
 * The target account must already exist (registered through the app with the
 * default player role). Idempotent: re-running is a no-op.
 */
export type ProvisionResult =
  | { ok: true; status: "provisioned" | "already-organizer" }
  | { ok: false; error: "user-not-found" | "captain-conflict"; message: string };

export async function provisionOrganizer(
  rawEmail: string,
): Promise<ProvisionResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) {
    return {
      ok: false,
      error: "user-not-found",
      message: "An email address is required.",
    };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    return {
      ok: false,
      error: "user-not-found",
      message: `No user found with email "${email}". Register through the app first, then re-run.`,
    };
  }

  if (user.role === "organizer") {
    return { ok: true, status: "already-organizer" };
  }

  if (user.role === "captain") {
    return {
      ok: false,
      error: "captain-conflict",
      message: `${email} is a captain. Captain accounts cannot be promoted to organizer directly; contact the developer.`,
    };
  }

  await db
    .update(users)
    .set({ role: "organizer" })
    .where(eq(users.id, user.id));

  await db.insert(auditLogs).values({
    actorUserId: user.id,
    action: "organizer.provisioned",
    entityType: "user",
    entityId: user.id,
    metadata: { previousRole: user.role },
  });

  return { ok: true, status: "provisioned" };
}
