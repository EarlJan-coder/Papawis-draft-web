import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth/guards";
import { enforceRateLimit, PICK_RATE_LIMIT } from "@/lib/rate-limit";
import { listPicks, makePick, type PickErrorCode } from "@/features/drafts/pick-service";

/**
 * Draft picks HTTP layer (Phase 5).
 *
 * POST submits a pick for the authenticated captain; GET returns the draft's
 * pick history. Errors are typed and mapped to status codes clients can act
 * on — notably 409 for a stale turn — and every response body is built from
 * this service's own messages, never from internals.
 */

const pickBodySchema = z.object({
  playerId: z.string().uuid(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

/** Service error codes → HTTP status. Stale/conflicting state is 409. */
const ERROR_STATUS: Record<PickErrorCode, number> = {
  forbidden: 403,
  "not-found": 404,
  "invalid-state": 409,
  "draft-paused": 409,
  "not-your-turn": 409,
  "already-drafted": 409,
  "not-eligible": 422,
};

type RouteContext = { params: Promise<{ draftId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { draftId } = await context.params;

  const auth = await requireApiUser(request.headers, ["captain"]);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthenticated" : "forbidden", message: auth.message },
      { status: auth.status },
    );
  }

  // Per-captain mutation budget — refused before any draft-state work.
  const rate = await enforceRateLimit(
    `draft-picks:POST:${auth.user.id}`,
    PICK_RATE_LIMIT,
  );
  if (!rate.ok) {
    return NextResponse.json(
      {
        error: "rate-limited",
        message: "Too many requests. Please try again later.",
      },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid-body", message: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const parsed = pickBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid-body",
        message: "playerId must be a UUID; idempotencyKey is optional.",
      },
      { status: 400 },
    );
  }

  const result = await makePick(
    { id: auth.user.id, role: "captain" },
    draftId,
    parsed.data.playerId,
    { idempotencyKey: parsed.data.idempotencyKey },
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: result.message },
      { status: ERROR_STATUS[result.error] },
    );
  }

  return NextResponse.json(
    { pick: result.pick, replayed: result.replayed === true },
    { status: result.replayed ? 200 : 201 },
  );
}

export async function GET(request: Request, context: RouteContext) {
  const { draftId } = await context.params;

  const auth = await requireApiUser(request.headers, ["captain", "organizer"]);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 401 ? "unauthenticated" : "forbidden", message: auth.message },
      { status: auth.status },
    );
  }

  const picks = await listPicks(draftId);
  return NextResponse.json({ picks });
}
