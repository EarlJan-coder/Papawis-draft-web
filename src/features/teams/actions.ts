"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireApiUser } from "@/lib/auth/guards";
import type { Actor } from "@/features/approvals/approval-service";
import { createTeam, deleteTeam, renameTeam } from "./team-service";

/**
 * Team management actions (Phase 4). Thin transport over the team service:
 * each action re-verifies the organizer role from the session before the
 * service re-checks authorization and league rules.
 */

export type TeamActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

type OrganizerGate = { actor: Actor } | { state: TeamActionState };

async function requireOrganizer(): Promise<OrganizerGate> {
  const auth = await requireApiUser(await headers(), ["organizer"]);
  if (!auth.ok || !auth.user.role) {
    return {
      state: {
        status: "error",
        message: auth.ok ? "Account has no role." : auth.message,
      },
    };
  }
  return { actor: { id: auth.user.id, role: auth.user.role } };
}

function refreshed(state: TeamActionState): TeamActionState {
  revalidatePath("/organizer");
  return state;
}

export async function createTeamAction(
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return gate.state;

  const name = String(formData.get("name") ?? "");
  const result = await createTeam(gate.actor, name);
  return refreshed(
    result.ok
      ? { status: "success", message: `Team “${result.team.name}” created.` }
      : { status: "error", message: result.message },
  );
}

export async function renameTeamAction(
  _previous: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return gate.state;

  const teamId = String(formData.get("teamId") ?? "");
  const name = String(formData.get("name") ?? "");
  const result = await renameTeam(gate.actor, teamId, name);
  return refreshed(
    result.ok
      ? { status: "success", message: `Renamed to “${result.team.name}”.` }
      : { status: "error", message: result.message },
  );
}

export async function deleteTeamAction(formData: FormData): Promise<void> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return;

  const teamId = String(formData.get("teamId") ?? "");
  await deleteTeam(gate.actor, teamId);
  revalidatePath("/organizer");
}
