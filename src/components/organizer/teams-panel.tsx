"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createTeamAction,
  deleteTeamAction,
  renameTeamAction,
  type TeamActionState,
} from "@/features/teams/actions";
import {
  assignCaptainAction,
  removeAssignmentAction,
  type DraftActionState,
} from "@/features/drafts/actions";
import type { CaptainCandidate } from "@/features/drafts/draft-service";

/**
 * Organizer team management (Phase 4, client component). All mutations go
 * through server actions that re-verify the organizer role and league rules;
 * the panel only renders state and surfaces the server's error messages.
 */

export type TeamEntry = {
  teamId: string;
  teamName: string;
  captainUserId: string | null;
  captainName: string | null;
  draftOrder: number | null;
};

const IDLE: TeamActionState = { status: "idle" };
const DRAFT_IDLE: DraftActionState = { status: "idle" };

function StateMessage({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      className={
        state.status === "error"
          ? "mt-2 text-sm text-destructive"
          : "mt-2 text-sm text-green-700"
      }
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

export function TeamsPanel({
  entries,
  candidates,
  draftId,
  draftStatus,
}: {
  entries: TeamEntry[];
  candidates: CaptainCandidate[];
  draftId: string | null;
  draftStatus: "none" | "setup" | "active" | "paused" | "completed";
}) {
  const [createState, createFormAction, createPending] = useActionState(
    createTeamAction,
    IDLE,
  );
  const canCreate = entries.length < 4;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Teams</h3>
        <Badge tone={entries.length === 4 ? "success" : "warning"}>
          {entries.length}/4
        </Badge>
      </div>

      <div className="mt-4 space-y-3">
        {entries.map((entry) => (
          <TeamRow
            key={entry.teamId}
            entry={entry}
            candidates={candidates}
            draftId={draftId}
            draftStatus={draftStatus}
          />
        ))}
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        )}
      </div>

      {canCreate ? (
        <form action={createFormAction} className="mt-4 flex gap-2">
          <Input
            name="name"
            placeholder="Team name"
            aria-label="New team name"
            maxLength={40}
            required
          />
          <Button type="submit" disabled={createPending} size="md">
            Add team
          </Button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          The league is capped at four teams.
        </p>
      )}
      <StateMessage state={createState} />
    </div>
  );
}

function TeamRow({
  entry,
  candidates,
  draftId,
  draftStatus,
}: {
  entry: TeamEntry;
  candidates: CaptainCandidate[];
  draftId: string | null;
  draftStatus: "none" | "setup" | "active" | "paused" | "completed";
}) {
  const [renameState, renameFormAction, renamePending] = useActionState(
    renameTeamAction,
    IDLE,
  );
  const [assignState, assignFormAction, assignPending] = useActionState(
    assignCaptainAction,
    DRAFT_IDLE,
  );
  const inSetup = draftStatus === "setup" && draftId !== null;

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{entry.teamName}</p>
          <p className="text-xs text-muted-foreground">
            {entry.captainName
              ? `Captain: ${entry.captainName} · Pick #${entry.draftOrder}`
              : "No captain assigned"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {entry.captainUserId && (
            <form action={removeAssignmentAction}>
              <input type="hidden" name="draftId" value={draftId ?? ""} />
              <input type="hidden" name="teamId" value={entry.teamId} />
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                disabled={!inSetup}
              >
                Unassign
              </Button>
            </form>
          )}
          <form
            action={deleteTeamAction}
            onSubmit={(event) => {
              if (!window.confirm(`Delete team “${entry.teamName}”?`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="teamId" value={entry.teamId} />
            <Button type="submit" variant="danger" size="sm">
              Delete
            </Button>
          </form>
        </div>
      </div>

      <form action={renameFormAction} className="mt-2 flex gap-2">
        <input type="hidden" name="teamId" value={entry.teamId} />
        <Input
          name="name"
          defaultValue={entry.teamName}
          aria-label={`Rename ${entry.teamName}`}
          maxLength={40}
          required
          className="h-8"
        />
        <Button type="submit" variant="outline" size="sm" disabled={renamePending}>
          Rename
        </Button>
      </form>
      <StateMessage state={renameState} />

      {inSetup && (
        <form action={assignFormAction} className="mt-2 flex flex-wrap gap-2">
          <input type="hidden" name="draftId" value={draftId} />
          <input type="hidden" name="teamId" value={entry.teamId} />
          <select
            name="captainUserId"
            aria-label={`Captain for ${entry.teamName}`}
            defaultValue={entry.captainUserId ?? ""}
            className="h-8 rounded-md border border-input bg-white px-2 text-sm"
            required
          >
            <option value="" disabled>
              Choose captain…
            </option>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.displayName} ({c.emailMasked})
              </option>
            ))}
          </select>
          <select
            name="draftOrder"
            aria-label={`Draft order for ${entry.teamName}`}
            defaultValue={entry.draftOrder ?? ""}
            className="h-8 rounded-md border border-input bg-white px-2 text-sm"
            required
          >
            <option value="" disabled>
              Pick #…
            </option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" disabled={assignPending}>
            {entry.captainUserId ? "Update" : "Assign"}
          </Button>
        </form>
      )}
      <StateMessage state={assignState} />
    </div>
  );
}
