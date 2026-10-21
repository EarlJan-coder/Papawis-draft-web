import { auth } from "@/lib/auth";

/**
 * Integration-test helpers that exercise the real Better Auth instance
 * against the real (test) database.
 */

const PASSWORD = "Sup3rSecret!pw";

let counter = 0;

/** Unique per-call email so tests never collide. */
export function newEmail(prefix = "it"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

export function testPassword(): string {
  return PASSWORD;
}

/**
 * Registers a user through the real sign-up endpoint and returns the
 * session cookie headers for subsequent guard checks.
 */
export async function signUpTestUser(
  email: string,
  extraBody: Record<string, unknown> = {},
): Promise<Headers> {
  const response = await auth.api.signUpEmail({
    body: {
      name: "Test User",
      email,
      password: PASSWORD,
      ...extraBody,
    } as never,
    asResponse: true,
  });

  if (!response.ok) {
    throw new Error(`signUp failed with status ${response.status}`);
  }

  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith("better-auth.session_token="));
  if (!cookie) {
    throw new Error("No session cookie in sign-up response.");
  }

  const headers = new Headers();
  headers.set("cookie", cookie.split(";")[0]);
  return headers;
}
