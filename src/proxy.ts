import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Optimistic route protection (Next.js 16 `proxy`, formerly middleware).
 *
 * This only checks for the *presence* of a session cookie to avoid flashing
 * protected pages to anonymous visitors. It is NOT a security boundary:
 * every page, server action, and route handler re-verifies the session
 * server-side via src/lib/auth/guards.ts.
 */

const MEMBER_PREFIXES = ["/dashboard", "/profile", "/team", "/draft"];
const ORGANIZER_PREFIXES = ["/organizer"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = !!getSessionCookie(request);

  const needsAuth =
    MEMBER_PREFIXES.some((p) => pathname.startsWith(p)) ||
    ORGANIZER_PREFIXES.some((p) => pathname.startsWith(p));

  if (needsAuth && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Send already-signed-in users away from auth pages.
  if (hasSession && (pathname === "/login" || pathname === "/register")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/profile/:path*",
    "/team/:path*",
    "/draft/:path*",
    "/organizer/:path*",
    "/login",
    "/register",
  ],
};
