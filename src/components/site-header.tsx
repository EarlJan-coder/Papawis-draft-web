import Link from "next/link";
import { getLeagueName } from "@/lib/config";

/**
 * Site header with role-aware navigation.
 *
 * The session lookup happens inside <Suspense> (required by Next 16 cache
 * components): the static shell ships immediately, then nav updates once the
 * session resolves. Authorization is NOT enforced here — pages and actions
 * re-check via src/lib/auth/guards.ts.
 */
import { getSessionUser } from "@/lib/auth/guards";
import { Suspense } from "react";
import { SignOutButton } from "./sign-out-button";

async function NavLinks() {
  const user = await getSessionUser();

  return (
    <nav
      aria-label="Main navigation"
      className="flex items-center gap-1 sm:gap-2"
    >
      {user ? (
        <>
          <Link
            href="/dashboard"
            className="rounded-md px-3 py-2 text-sm font-medium text-brand-100 hover:text-white hover:bg-brand-700 transition-colors"
          >
            Dashboard
          </Link>
          {user.role === "organizer" && (
            <Link
              href="/organizer"
              className="rounded-md px-3 py-2 text-sm font-medium text-brand-100 hover:text-white hover:bg-brand-700 transition-colors"
            >
              Organizer
            </Link>
          )}
          <span className="hidden md:inline-block max-w-[10rem] truncate rounded-md px-3 py-2 text-sm text-brand-200">
            {user.name || user.email}
          </span>
          <SignOutButton />
        </>
      ) : (
        <>
          <Link
            href="/login"
            className="rounded-md px-3 py-2 text-sm font-medium text-brand-100 hover:text-white hover:bg-brand-700 transition-colors"
          >
            Log in
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100 transition-colors"
          >
            Register
          </Link>
        </>
      )}
    </nav>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-brand-800/40 bg-brand-900 text-white">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-sm font-bold"
          >
            🏀
          </span>
          <span className="text-lg font-semibold tracking-tight">
            {getLeagueName()}
          </span>
        </Link>
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className="h-8 w-40 animate-pulse rounded-md bg-brand-800"
            />
          }
        >
          <NavLinks />
        </Suspense>
      </div>
    </header>
  );
}
