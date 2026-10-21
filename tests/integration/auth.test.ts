import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { requireApiUser } from "@/lib/auth/guards";
import { users } from "@/db/schema";
import { newEmail, signUpTestUser } from "../setup/helpers";
import { resetDatabase } from "../setup/db";

/**
 * Authentication integration tests against the real Better Auth instance
 * and the disposable test database.
 */
describe("authentication", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it("creates new registrations with the player role by default", async () => {
    const email = newEmail("default-role");
    await signUpTestUser(email);

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    expect(row).toBeDefined();
    expect(row?.role).toBe("player");
    expect(row?.status).toBe("active");
  });

  it("ignores role/status fields supplied at sign-up (privilege escalation attempt)", async () => {
    const email = newEmail("escalation");
    await signUpTestUser(email, {
      role: "organizer",
      status: "suspended",
      // Also try snake_case variants in case of field mapping mistakes.
      user_role: "organizer",
    });

    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    expect(row?.role).toBe("player");
    expect(row?.status).toBe("active");
  });

  it("verifies a real session through requireApiUser", async () => {
    const email = newEmail("session");
    const headers = await signUpTestUser(email);

    const result = await requireApiUser(headers);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.email).toBe(email);
      expect(result.user.role).toBe("player");
      expect(result.user.status).toBe("active");
    }
  });

  it("rejects requests without a session cookie with 401", async () => {
    const result = await requireApiUser(new Headers());
    expect(result).toMatchObject({ ok: false, status: 401 });
  });

  it("rejects player sessions on organizer-only guards with 403", async () => {
    const email = newEmail("organizer-guard");
    const headers = await signUpTestUser(email);

    const result = await requireApiUser(headers, ["organizer"]);

    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("accepts organizer sessions on organizer-only guards", async () => {
    const email = newEmail("organizer-ok");
    const headers = await signUpTestUser(email);

    await db
      .update(users)
      .set({ role: "organizer" })
      .where(eq(users.email, email));

    const result = await requireApiUser(headers, ["organizer"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.role).toBe("organizer");
    }
  });
});
