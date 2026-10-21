"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/guards";
import { formToProfileInput } from "./form-input";
import {
  getProfileForUser,
  submitProfile,
  updateProfile,
} from "./profile-service";

/**
 * Profile form submission (server action).
 *
 * Thin transport over the profile service: authenticate, normalize the raw
 * FormData, submit-or-update based on whether a profile already exists, and
 * map the typed result into `useActionState` state. All validation and
 * authorization rules live in the service layer (integration-tested).
 */

export type ProfileFormState = {
  status: "idle" | "success" | "error";
  message?: string;
  issues?: string[];
};

export async function saveProfileAction(
  _previous: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const user = await requireUser();
  const input = formToProfileInput(formData);

  const view = await getProfileForUser(user.id);
  const result = view.profile
    ? await updateProfile(user.id, input)
    : await submitProfile(user.id, input);

  if (!result.ok) {
    return { status: "error", message: result.message, issues: result.issues };
  }

  revalidatePath("/dashboard");
  return {
    status: "success",
    message: view.profile
      ? "Profile saved — it's back in the organizer's review queue."
      : "Profile submitted for organizer approval.",
  };
}
