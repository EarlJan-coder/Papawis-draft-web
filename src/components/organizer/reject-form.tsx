"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rejectAction, type DecisionState } from "@/features/approvals/actions";

const initialState: DecisionState = { status: "idle" };

/**
 * Rejection form with a required reason. The reason travels through the
 * server action to the approval service, which stores it and audits it.
 */
export function RejectForm({ profileId }: { profileId: string }) {
  const [state, formAction, pending] = useActionState(
    rejectAction,
    initialState,
  );

  return (
    <form action={formAction} className="mt-3 space-y-2">
      <input type="hidden" name="profileId" value={profileId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-56 flex-1">
          <label
            htmlFor={`reject-reason-${profileId}`}
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Rejection reason (required)
          </label>
          <Input
            id={`reject-reason-${profileId}`}
            name="reason"
            required
            maxLength={300}
            placeholder="e.g. Height unverified"
          />
        </div>
        <Button type="submit" variant="danger" size="sm" disabled={pending}>
          {pending ? "Rejecting…" : "Reject"}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}
    </form>
  );
}
