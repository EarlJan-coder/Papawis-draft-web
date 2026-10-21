"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireApiUser } from "@/lib/auth/guards";
import {
  approveProfile,
  rejectProfile,
  setDraftEligibility,
  type Actor,
} from "./approval-service";

/**
 * Organizer decision actions (approve / reject / eligibility toggle).
 *
 * Thin transport over the approval service. Each action re-verifies the
 * organizer role from the session (headers) before touching the service,
 * which re-checks authorization, self-approval, and state transitions.
 */

export type DecisionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

type OrganizerGate = { actor: Actor } | { state: DecisionState };

async function requireOrganizer(): Promise<OrganizerGate> {
  const auth = await requireApiUser(await headers(), ["organizer"]);
  if (!auth.ok) {
    return { state: { status: "error", message: auth.message } as DecisionState };
  }
  const role = auth.user.role;
  if (!role) {
    return {
      state: { status: "error", message: "Account has no role." } as DecisionState,
    };
  }
  return { actor: { id: auth.user.id, role } };
}

export async function approveAction(formData: FormData): Promise<void> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return;

  const profileId = String(formData.get("profileId") ?? "");
  await approveProfile(gate.actor, profileId);
  revalidatePath("/organizer");
}

export async function rejectAction(
  _previous: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return gate.state;

  const profileId = String(formData.get("profileId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const result = await rejectProfile(gate.actor, profileId, reason);
  revalidatePath("/organizer");
  return result.ok
    ? { status: "success", message: "Profile rejected." }
    : { status: "error", message: result.message };
}

export async function toggleEligibilityAction(
  formData: FormData,
): Promise<void> {
  const gate = await requireOrganizer();
  if (!("actor" in gate)) return;

  const profileId = String(formData.get("profileId") ?? "");
  const eligible = formData.get("eligible") === "true";
  await setDraftEligibility(gate.actor, profileId, eligible);
  revalidatePath("/organizer");
}
