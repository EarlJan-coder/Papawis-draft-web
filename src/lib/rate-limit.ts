import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window rate limiting backed by the shared `rate_limit` table
 * (Phase 8 security pass).
 *
 * Each key is namespaced with its window number, so one atomic upsert both
 * counts and rolls the window over — no read-then-write race. Rows use the
 * same table Better Auth's database limiter prunes, so stale windows are
 * cleaned up by the same maintenance path (key prefixes never overlap).
 */

export type RateLimitRule = {
  /** Length of one fixed window, in milliseconds. */
  windowMs: number;
  /** Requests allowed per window. */
  max: number;
};

export type RateLimitDecision =
  | { ok: true; count: number }
  | { ok: false; retryAfterSec: number };

/**
 * Count one request against `key`. Returns `ok: false` (with how long to
 * wait) once the window's budget is spent. Purely mechanical — callers
 * decide where in their handler it runs and what 429 body to return.
 */
export async function enforceRateLimit(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitDecision> {
  const now = Date.now();
  const windowNumber = Math.floor(now / rule.windowMs);
  const rowKey = `${key}:${windowNumber}`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key: rowKey, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: sql`${rateLimits.count} + 1`, lastRequest: now },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  if (count > rule.max) {
    const windowEndsAt = (windowNumber + 1) * rule.windowMs;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowEndsAt - now) / 1000)) };
  }
  return { ok: true, count };
}

/**
 * Budget for draft pick submissions (POST /api/drafts/:draftId/picks).
 * Generous for real draft-day use — an entire league draft is a handful of
 * requests per captain — while capping a rogue session's mutation spam.
 */
export const PICK_RATE_LIMIT: RateLimitRule = { windowMs: 10_000, max: 15 };
