import { requireUser } from "@/lib/auth/guards";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Suspense } from "react";

/**
 * Player dashboard. Phase 3 adds profile completion/approval widgets;
 * this establishes the authenticated shell and shows account state.
 * Session access is inside <Suspense> (required by cache components).
 */
async function DashboardContent() {
  const user = await requireUser();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name || "player"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Your player dashboard for the league.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>{user.email}</CardDescription>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="brand">Role: {user.role}</Badge>
            <Badge tone={user.status === "active" ? "success" : "danger"}>
              Status: {user.status}
            </Badge>
          </div>
        </Card>

        <Card>
          <CardTitle className="text-base">Player profile</CardTitle>
          <CardDescription>
            Profile editing becomes available once your account is linked to a
            player profile.
          </CardDescription>
          <div className="mt-3">
            <Badge tone="warning">Profile setup coming in the next phase</Badge>
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
