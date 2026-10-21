import { requireRole } from "@/lib/auth/guards";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Suspense } from "react";

/**
 * Organizer control panel.
 * Phase 3 wires the pending-approval queue, Phase 4 the team/captain and
 * draft lifecycle controls. Access is restricted to the organizer role and
 * re-verified on every request.
 */
async function OrganizerContent() {
  const user = await requireRole(["organizer"]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organizer console</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage players, teams, and the draft.
          </p>
        </div>
        <Badge tone="brand">Signed in as {user.email}</Badge>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardTitle className="text-base">Player approvals</CardTitle>
          <CardDescription>
            Review registered players and mark draft eligibility.
          </CardDescription>
          <div className="mt-3">
            <Badge tone="warning">Coming in phase 3</Badge>
          </div>
        </Card>
        <Card>
          <CardTitle className="text-base">Teams &amp; captains</CardTitle>
          <CardDescription>
            Configure the four teams, assign captains, and set draft order.
          </CardDescription>
          <div className="mt-3">
            <Badge tone="warning">Coming in phase 4</Badge>
          </div>
        </Card>
        <Card>
          <CardTitle className="text-base">Draft controls</CardTitle>
          <CardDescription>
            Start, pause, resume, undo, and publish the draft.
          </CardDescription>
          <div className="mt-3">
            <Badge tone="warning">Coming in phase 5</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function OrganizerPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-10 sm:px-6">
          <div className="h-8 w-56 animate-pulse rounded bg-muted" />
          <div className="h-48 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      }
    >
      <OrganizerContent />
    </Suspense>
  );
}
