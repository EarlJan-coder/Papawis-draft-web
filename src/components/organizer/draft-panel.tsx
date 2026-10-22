"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createDraftAction,
  draftTransitionAction,
  setRoundsAction,
  type DraftActionState,
} from "@/features/drafts/actions";
import type { DraftReadiness } from "@/features/drafts/draft-service";

/**
 * Draft lifecycle controls (Phase 4, client component). The service is the
 * source of truth for transitions and readiness — this panel renders them
 * and surfaces server error messages inline.
 */

const IDLE: DraftActionState = { status: "idle" };

type DraftSummary = {
  id: string;
  status: "setup" | "active" | "paused" | "completed";
  totalRounds: number;
  currentPickNumber: number;
};

const STATUS_TONE = {
  setup: "warning",
  active: "success",
  paused: "warning",
  completed: "neutral",
} as const;

export function DraftPanel({
  draft,
  readiness,
}: {
  draft: DraftSummary | null;
  readiness: DraftReadiness | null;
}) {
  const [createState, createFormAction, createPending] = useActionState(
    createDraftAction,
    IDLE,
  );
  const [roundsState, roundsFormAction, roundsPending] = useActionState(
    setRoundsAction,
    IDLE,
  );

  if (!draft) {
    return (
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-medium">Draft</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No draft yet. Create one to start assigning captains.
        </p>
        <form action={createFormAction} className="mt-4 flex gap-2">
          <Input
            type="number"
            name="totalRounds"
            min={1}
            max={20}
            defaultValue={8}
            aria-label="Number of rounds"
            className="w-24"
            required
          />
          <Button type="submit" disabled={createPending}>
            Create draft
          </Button>
        </form>
        <StateMessage state={createState} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Draft</h3>
        <Badge tone={STATUS_TONE[draft.status]}>
          {draft.status === "setup"
            ? "Setup"
            : draft.status === "active"
              ? "Live"
              : draft.status === "paused"
                ? "Paused"
                : "Completed"}
        </Badge>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {draft.totalRounds} rounds ·{" "}
        {draft.status === "setup"
          ? `${draft.totalRounds * 4} total picks`
          : `on pick ${draft.currentPickNumber} of ${draft.totalRounds * 4}`}
      </p>

      {draft.status === "setup" && (
        <>
          <form action={roundsFormAction} className="mt-3 flex gap-2">
            <input type="hidden" name="draftId" value={draft.id} />
            <Input
              type="number"
              name="totalRounds"
              min={1}
              max={20}
              defaultValue={draft.totalRounds}
              aria-label="Number of rounds"
              className="w-24"
              required
            />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={roundsPending}
            >
              Save rounds
            </Button>
          </form>
          <StateMessage state={roundsState} />

          <div className="mt-3">
            <p className="text-sm font-medium">Start checklist</p>
            <ul className="mt-1 space-y-1 text-sm">
              <Check done={!readiness?.missing.includes("teams")}>
                Four teams in the league
              </Check>
              <Check done={!readiness?.missing.includes("captains")}>
                Four captains assigned
              </Check>
              <Check done={!readiness?.missing.includes("draft-order")}>
                Draft order set (picks 1–4)
              </Check>
            </ul>
          </div>

          <form action={draftTransitionAction} className="mt-3">
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="transition" value="start" />
            <Button
              type="submit"
              disabled={!readiness?.ready}
              title={
                readiness?.ready
                  ? undefined
                  : `Missing: ${readiness?.missing.join(", ")}`
              }
            >
              Start draft
            </Button>
          </form>
        </>
      )}

      {draft.status === "active" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <form
            action={draftTransitionAction}
            className="flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="transition" value="pause" />
            <Input
              name="reason"
              placeholder="Pause reason (optional)"
              aria-label="Pause reason"
              className="h-8 w-56"
              maxLength={200}
            />
            <Button type="submit" variant="outline" size="sm">
              Pause
            </Button>
          </form>
          <form
            action={draftTransitionAction}
            onSubmit={(event) => {
              if (
                !window.confirm(
                  "Complete the draft? Captains will no longer be able to pick.",
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="transition" value="complete" />
            <Button type="submit" variant="danger" size="sm">
              Complete
            </Button>
          </form>
        </div>
      )}

      {draft.status === "paused" && (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={draftTransitionAction}>
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="transition" value="resume" />
            <Button type="submit" size="sm">
              Resume draft
            </Button>
          </form>
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
              Complete
            </Button>
          </form>
        </div>
      )}

      {draft.status === "completed" && (
        <p className="mt-3 text-sm text-muted-foreground">
          This draft is complete. Rosters can be published from the organizer
          console.
        </p>
      )}
    </div>
  );
}

function Check({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span aria-hidden>{done ? "✓" : "○"}</span>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>
        {children}
      </span>
    </li>
  );
}

function StateMessage({ state }: { state: DraftActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      className={
        state.status === "error"
          ? "mt-2 text-sm text-destructive"
          : "mt-2 text-sm text-green-700"
      }
      role={state.status === "error" ? "alert" : "status"}
      data-testid="draft-state-message"
    >
      {state.message}
    </p>
  );
}
