import { requireRole } from "@/lib/auth/guards";
import {
  getLatestDraft,
} from "@/features/drafts/draft-service";
import { getDraftTurn } from "@/features/drafts/pick-service";
import {
  getDraftHistory,
  getTeamRosters,
  listAvailablePlayers,
} from "@/features/drafts/board-service";
import { DraftRoom } from "@/components/draft/draft-room";
import { Suspense } from "react";

/**
 * Draft room (Phase 6): captains and the organizer see live draft state —
 * turn banner, available-player board, rosters, and history. The client
 * DraftRoom submits picks through the picks HTTP layer; every pick is
 * re-validated server-side (turn, eligibility, uniqueness).
 */
async function DraftContent() {
  const user = await requireRole(["captain", "organizer"]);
  const draft = await getLatestDraft();

  if (!draft) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-semibold">Draft room</h1>
        <p className="mt-4 text-sm text-muted-foreground">
          No draft has been created yet. The organizer sets teams and captains
          from the organizer console.
        </p>
      </div>
    );
  }

  const [turn, rosters, players, rawHistory] = await Promise.all([
    getDraftTurn(draft.id),
    getTeamRosters(draft.id),
    listAvailablePlayers(draft.id),
    getDraftHistory(draft.id),
  ]);

  return (
    <DraftRoom
      viewer={{ id: user.id, role: user.role === "organizer" ? "organizer" : "captain" }}
      draft={{
        id: draft.id,
        status: draft.status,
        totalRounds: draft.totalRounds,
        currentPickNumber: draft.currentPickNumber,
        publishedAt: draft.publishedAt ? draft.publishedAt.toISOString() : null,
      }}
      turn={turn}
      rosters={rosters}
      players={players}
      history={rawHistory.map((h) => ({
        ...h,
        pickedAt: h.pickedAt.toISOString(),
        undoneAt: h.undoneAt ? h.undoneAt.toISOString() : null,
      }))}
    />
  );
}

export default function DraftPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-10 sm:px-6">
          <div className="h-8 w-40 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded-lg border border-border bg-card" />
          <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      }
    >
      <DraftContent />
    </Suspense>
  );
}
