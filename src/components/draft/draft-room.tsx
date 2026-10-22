"use client";

import { useMemo, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  draftTransitionAction,
  undoPickAction,
  type DraftActionState,
} from "@/features/drafts/actions";
import {
  publishDraftAction,
  type PublishActionState,
} from "@/features/publications/actions";
import {
  positionCoverageWarnings,
} from "@/features/drafts/coverage";
import type { AvailablePlayer, RosterSummary } from "@/features/drafts/board-service";
import type { DraftTurn } from "@/features/drafts/pick-service";

/**
 * Draft room (Phase 6, client component): current-turn banner, the available
 * player board with search + position filter, pick confirmation with inline
 * error feedback (409 conflicts included), roster summaries with advisory
 * position coverage, pick history, and organizer controls.
 */

const IDLE: DraftActionState = { status: "idle" };
const POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;

type DraftSummary = {
  id: string;
  status: "setup" | "active" | "paused" | "completed";
  totalRounds: number;
  currentPickNumber: number;
  publishedAt: string | null;
};

type HistoryEntry = {
  pickNumber: number;
  playerName: string;
  teamName: string;
  pickedAt: string;
  undoneAt: string | null;
  undoReason: string | null;
};

export function DraftRoom({
  viewer,
  draft,
  turn,
  rosters,
  players,
  history,
}: {
  viewer: { id: string; role: "captain" | "organizer" };
  draft: DraftSummary | null;
  turn: DraftTurn | null;
  rosters: RosterSummary[];
  players: AvailablePlayer[];
  history: HistoryEntry[];
}) {
  const totalPicks = draft ? draft.totalRounds * 4 : 0;
  const isOnTurn =
    draft?.status === "active" && turn !== null && turn.captainUserId === viewer.id;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold">Draft room</h1>

      {!draft ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No draft has been created yet. The organizer sets teams and captains
          from the organizer console.
        </p>
      ) : (
        <>
          <TurnBanner
            draft={draft}
            turn={turn}
            totalPicks={totalPicks}
            isOnTurn={isOnTurn}
            viewerRole={viewer.role}
          />

          {draft.status === "active" && (
            <Board players={players} isOnTurn={isOnTurn} draftId={draft.id} />
          )}

          <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
            <Rosters rosters={rosters} />
            <History entries={history} />
          </div>

          {viewer.role === "organizer" && (
            <OrganizerControls draft={draft} hasPicks={history.length > 0} />
          )}
        </>
      )}
    </div>
  );
}

function TurnBanner({
  draft,
  turn,
  totalPicks,
  isOnTurn,
  viewerRole,
}: {
  draft: DraftSummary;
  turn: DraftTurn | null;
  totalPicks: number;
  isOnTurn: boolean;
  viewerRole: "captain" | "organizer";
}) {
  const label =
    draft.status === "completed"
      ? "Draft completed"
      : draft.status === "paused"
        ? "Draft paused"
        : draft.status === "setup"
          ? "Draft in setup"
          : null;

  return (
    <div
      className={
        isOnTurn
          ? "mt-4 rounded-lg border-2 border-brand-600 bg-brand-50 p-4"
          : "mt-4 rounded-lg border border-border bg-card p-4"
      }
      data-testid="turn-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {label ?? (
            <>
              On the clock:{" "}
              <span className="font-semibold">
                {turn?.captainName ?? "—"} ({turn?.teamName ?? "—"})
              </span>
            </>
          )}
        </p>
        <Badge tone={draft.status === "active" ? "success" : "warning"}>
          Pick {Math.min(draft.currentPickNumber, totalPicks)} of {totalPicks}
        </Badge>
      </div>
      {isOnTurn && (
        <p className="mt-1 text-sm font-medium text-brand-800">
          It&apos;s your turn — make a pick below.
        </p>
      )}
      {viewerRole === "organizer" && draft.status === "paused" && (
        <p className="mt-1 text-sm text-muted-foreground">
          Resume the draft from the organizer controls below.
        </p>
      )}
    </div>
  );
}

function Board({
  players,
  isOnTurn,
  draftId,
}: {
  players: AvailablePlayer[];
  isOnTurn: boolean;
  draftId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [position, setPosition] = useState<string>("");
  const [pending, setPending] = useState<AvailablePlayer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return players.filter((p) => {
      if (position && !p.positions.includes(position)) return false;
      if (needle && !p.displayName.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [players, search, position]);

  function openConfirm(player: AvailablePlayer) {
    setPending(player);
    setIdempotencyKey(crypto.randomUUID());
    setError(null);
  }

  async function confirmPick() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/drafts/${draftId}/picks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: pending.profileId,
          idempotencyKey,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setError(body?.message ?? "The pick could not be made. Try again.");
        return;
      }
      setPending(null);
      setIdempotencyKey(null);
      router.refresh();
    } catch {
      setError("Network error — the pick was not sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Available players</h2>
        <Badge tone="neutral">{filtered.length}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          aria-label="Search players"
          className="h-8 w-56"
        />
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          aria-label="Filter by position"
          className="h-8 rounded-md border border-input bg-white px-2 text-sm"
        >
          <option value="">All positions</option>
          {POSITIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          role="alert"
          data-testid="pick-error"
        >
          {error}
        </p>
      )}

      <ul className="mt-3 max-h-96 space-y-2 overflow-y-auto pr-1">
        {filtered.map((player) => (
          <li
            key={player.profileId}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <Avatar name={player.displayName} />
              <div>
                <p className="text-sm font-medium">{player.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {player.positions.join(" · ")}
                  {player.heightCm != null ? ` · ${player.heightCm} cm` : ""}
                  {player.skillLevel ? ` · ${player.skillLevel}` : ""}
                  {player.ageYears != null ? ` · ${player.ageYears} yrs` : ""}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              disabled={!isOnTurn}
              onClick={() => openConfirm(player)}
              title={isOnTurn ? undefined : "Not your team's turn"}
            >
              Draft
            </Button>
          </li>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No players match.</p>
        )}
      </ul>

      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm pick"
          data-testid="confirm-pick-dialog"
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-white p-5">
            <h3 className="font-semibold">Draft {pending.displayName}?</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {pending.positions.join(" · ")}
              {pending.heightCm != null ? ` · ${pending.heightCm} cm` : ""}
              {pending.skillLevel ? ` · ${pending.skillLevel}` : ""}
            </p>
            {error && (
              <p className="mt-3 text-sm text-red-800" role="alert">
                {error}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPending(null);
                  setError(null);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={confirmPick} disabled={busy}>
                {busy ? "Drafting…" : "Confirm pick"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800"
    >
      {initials || "?"}
    </span>
  );
}

function Rosters({ rosters }: { rosters: RosterSummary[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-medium">Team rosters</h2>
      <div className="mt-3 space-y-3">
        {rosters.map((roster) => {
          const warnings = positionCoverageWarnings(roster.players);
          return (
            <div
              key={roster.teamId}
              className="rounded-md border border-border bg-background p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  #{roster.draftOrder} {roster.teamName}
                </p>
                <Badge tone="neutral">{roster.players.length} players</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Captain: {roster.captainName ?? "—"}
              </p>
              {roster.players.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {roster.players.map((player) => (
                    <li key={player.profileId} className="text-sm">
                      <span className="text-muted-foreground">
                        #{player.pickNumber}
                      </span>{" "}
                      {player.displayName}{" "}
                      <span className="text-xs text-muted-foreground">
                        {player.positions.join("/")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {warnings.length > 0 && (
                <ul className="mt-2 space-y-0.5" data-testid="coverage-warnings">
                  {warnings.map((warning) => (
                    <li key={warning} className="text-xs text-amber-700">
                      ⚠ {warning}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function History({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-medium">Pick history</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No picks yet.</p>
      ) : (
        <ol className="mt-2 space-y-1" data-testid="pick-history">
          {[...entries].reverse().map((entry) => (
            <li
              key={entry.pickNumber}
              className={
                entry.undoneAt
                  ? "text-sm text-muted-foreground line-through"
                  : "text-sm"
              }
            >
              #{entry.pickNumber} · {entry.teamName} · {entry.playerName}
              {entry.undoneAt && (
                <span className="not-italic">
                  {" "}
                  (undone{entry.undoReason ? `: ${entry.undoReason}` : ""})
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function OrganizerControls({
  draft,
  hasPicks,
}: {
  draft: DraftSummary;
  hasPicks: boolean;
}) {
  const [undoState, undoFormAction, undoPending] = useActionState(
    undoPickAction,
    IDLE,
  );
  const [publishState, publishFormAction, publishPending] = useActionState(
    publishDraftAction,
    IDLE as PublishActionState,
  );
  const [pauseReason, setPauseReason] = useState("");

  return (
    <div className="mt-8 rounded-lg border border-border bg-card p-4">
      <h2 className="font-medium">Organizer controls</h2>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {(draft.status === "active" || draft.status === "paused") && (
          <form action={draftTransitionAction} className="flex items-end gap-2">
            <input type="hidden" name="draftId" value={draft.id} />
            <input
              type="hidden"
              name="transition"
              value={draft.status === "active" ? "pause" : "resume"}
            />
            {draft.status === "active" && (
              <Input
                name="reason"
                value={pauseReason}
                onChange={(e) => setPauseReason(e.target.value)}
                placeholder="Pause reason (optional)"
                aria-label="Pause reason"
                className="h-8 w-56"
                maxLength={200}
              />
            )}
            <Button type="submit" variant="outline" size="sm">
              {draft.status === "active" ? "Pause draft" : "Resume draft"}
            </Button>
          </form>
        )}
        {(draft.status === "active" || draft.status === "paused") && (
          <form
            action={draftTransitionAction}
            onSubmit={(event) => {
              if (!window.confirm("Complete the draft now?")) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="transition" value="complete" />
            <Button type="submit" variant="danger" size="sm">
              Complete draft
            </Button>
          </form>
        )}
        {hasPicks && draft.status !== "setup" && draft.status !== "completed" && (
          <form action={undoFormAction} className="flex items-end gap-2">
            <input type="hidden" name="draftId" value={draft.id} />
            <Input
              name="reason"
              placeholder="Undo reason (required)"
              aria-label="Undo reason"
              className="h-8 w-56"
              maxLength={200}
              required
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={undoPending}
            >
              Undo last pick
            </Button>
          </form>
        )}
        {draft.status === "completed" &&
          (draft.publishedAt ? (
            <p
              className="text-sm text-green-700"
              data-testid="published-indicator"
            >
              Rosters published — live on the homepage.
            </p>
          ) : (
            <form
              action={publishFormAction}
              onSubmit={(event) => {
                if (
                  !window.confirm(
                    "Publish rosters? This makes them public and cannot be undone.",
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              <input type="hidden" name="draftId" value={draft.id} />
              <Button type="submit" size="sm" disabled={publishPending}>
                {publishPending ? "Publishing…" : "Publish rosters"}
              </Button>
            </form>
          ))}
      </div>
      {undoState.status !== "idle" && undoState.message && (
        <p
          className={
            undoState.status === "error"
              ? "mt-2 text-sm text-destructive"
              : "mt-2 text-sm text-green-700"
          }
          role={undoState.status === "error" ? "alert" : "status"}
        >
          {undoState.message}
        </p>
      )}
      {publishState.status !== "idle" && publishState.message && (
        <p
          className={
            publishState.status === "error"
              ? "mt-2 text-sm text-destructive"
              : "mt-2 text-sm text-green-700"
          }
          role={publishState.status === "error" ? "alert" : "status"}
          data-testid="publish-message"
        >
          {publishState.message}
        </p>
      )}
    </div>
  );
}
