"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireApiUser } from "@/lib/auth/guards";
import type { Actor } from "@/features/approvals/approval-service";
import { publishDraft } from "./publication-service";

/**
 * Publication action (Phase 7). Thin transport over the publication
 * service: the session is re-verified as organizer here, and the service
 * re-checks role, draft state, and one-shot publication.
 */

export type PublishActionState = {
  status: "idle" | "success" | "error";
  message?: string;
};

export async function publishDraftAction(
  _previous: PublishActionState,
  formData: FormData,
): Promise<PublishActionState> {
  const auth = await requireApiUser(await headers(), ["organizer"]);
  if (!auth.ok || !auth.user.role) {
    return {
      status: "error",
      message: auth.ok ? "Account has no role." : auth.message,
    };
  }
  const actor: Actor = { id: auth.user.id, role: auth.user.role };

  const draftId = String(formData.get("draftId") ?? "");
  const result = await publishDraft(actor, draftId);
  if (!result.ok) return { status: "error", message: result.message };

  revalidatePath("/");
  revalidatePath("/draft");
  revalidatePath("/organizer");
  return { status: "success", message: "Rosters published." };
}
