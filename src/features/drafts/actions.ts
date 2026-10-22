"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireApiUser } from "@/lib/auth/guards";
import type { Actor } from "@/features/approvals/approval-service";
import {
  assignCaptain,
  completeDraft,
  createDraft,
  pauseDraft,
  removeAssignment,
  resumeDraft,
  setDraftRounds,
  startDraft,
} from "./draft-service";

/**
 * Draft setup + lifecycle actions (Phase 4). Thin transport over the draft
 * service; every action re-verifies the organizer role from the session,
 * and the service re-checks authorization, eligibility, and state.
 */

export type DraftActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

type OrganizerGate = { actor: Actor } | { state: DraftActionState };

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

function refreshed(state: DraftActionState): DraftActionState {
  revalidatePath("/organizer");
  revalidatePath("/draft");
  return state;
}

export async function createDraftAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return gate.state;

  const rounds = Number(formData.get("totalRounds") ?? 8);
  const result = await createDraft(gate.actor, { totalRounds: rounds });
  return refreshed(
    result.ok
      ? { status: "success", message: "Draft created." }
      : { status: "error", message: result.message },
  );
}

export async function setRoundsAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return gate.state;

  const draftId = String(formData.get("draftId") ?? "");
  const rounds = Number(formData.get("totalRounds") ?? 0);
  const result = await setDraftRounds(gate.actor, draftId, rounds);
  return refreshed(
    result.ok
      ? { status: "success", message: `Draft set to ${rounds} rounds.` }
      : { status: "error", message: result.message },
  );
}

export async function assignCaptainAction(
  _previous: DraftActionState,
  formData: FormData,
): Promise<DraftActionState> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return gate.state;

  const draftId = String(formData.get("draftId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const captainUserId = String(formData.get("captainUserId") ?? "");
  const draftOrder = Number(formData.get("draftOrder") ?? 0);
  const result = await assignCaptain(
    gate.actor,
    draftId,
    teamId,
    captainUserId,
    draftOrder,
  );
  return refreshed(
    result.ok
      ? { status: "success", message: "Captain assigned." }
      : { status: "error", message: result.message },
  );
}

export async function removeAssignmentAction(formData: FormData): Promise<void> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return;

  const draftId = String(formData.get("draftId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  await removeAssignment(gate.actor, draftId, teamId);
  revalidatePath("/organizer");
  revalidatePath("/draft");
}

export async function draftTransitionAction(
  formData: FormData,
): Promise<void> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return;

  const draftId = String(formData.get("draftId") ?? "");
  const transition = String(formData.get("transition") ?? "");

  switch (transition) {
    case "start":
      await startDraft(gate.actor, draftId);
      break;
    case "pause": {
      const reason = String(formData.get("reason") ?? "");
      await pauseDraft(gate.actor, draftId, reason);
      break;
    }
    case "resume":
      await resumeDraft(gate.actor, draftId);
      break;
    case "complete":
      await completeDraft(gate.actor, draftId);
      break;
  }

  revalidatePath("/organizer");
  revalidatePath("/draft");
}
