import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SessionUser } from "@/lib/auth";

/**
 * Centralized session + role guards.
 *
 * Every call verifies the session against the database via Better Auth —
 * nothing trusts client-supplied identity or role. Route groups and proxies
 * are UX only; enforcement always happens here (server components, server
 * actions, and API route handlers).
 */

/** Returns the authenticated user for the current request, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if (session.user.status !== "active") return null;
  return session.user;
}

/**
 * Require an authenticated, active user for a page.
 * Redirects anonymous/suspended visitors to the login page.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Require one of the given roles for a page.
 * Redirects anonymous visitors to login and unauthorized users to /forbidden.
 */
export async function requireRole(
  roles: SessionUser["role"][],
): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}

export type ApiAuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; status: 401 | 403; message: string };

/**
 * API variant of the guards: never throws/redirects, returns a discriminated
 * result so route handlers can map it to a typed JSON error response.
 */
export async function requireApiUser(
  requestHeaders: Headers,
  roles?: SessionUser["role"][],
): Promise<ApiAuthResult> {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) {
    return { ok: false, status: 401, message: "Authentication required." };
  }
  if (session.user.status !== "active") {
    return { ok: false, status: 403, message: "Account is not active." };
  }
  if (roles && !roles.includes(session.user.role)) {
    return {
      ok: false,
      status: 403,
      message: "You do not have permission to perform this action.",
    };
  }
  return { ok: true, user: session.user };
}
