import { requireUser } from "@/lib/auth/guards";
import { getProfileForUser } from "@/features/profiles/profile-service";
import { getCurrentDraft, getLatestDraft, listDraftAssignments } from "@/features/drafts/draft-service";
import { getDraftTurn } from "@/features/drafts/pick-service";
import { ProfileForm } from "@/components/profile-form";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Suspense } from "react";

/**
 * Player dashboard: account state, profile status with completion, and the
 * profile form (create or edit). Session and profile access sit inside
 * <Suspense> (required by cache components).
 */

const STATUS_BADGE = {
  pending: { tone: "warning", label: "Awaiting review" },
  approved: { tone: "success", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
} as const;

async function DashboardContent() {
  const user = await requireUser();
  const view = await getProfileForUser(user.id);
  const profile = view.profile;
  const badge = profile ? STATUS_BADGE[profile.profileStatus] : null;

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
            {profile
              ? "Your profile as the organizers see it."
              : "Create your profile to be reviewed for the draft."}
          </CardDescription>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {badge ? (
              <Badge tone={badge.tone}>{badge.label}</Badge>
            ) : (
              <Badge tone="warning">Not submitted</Badge>
            )}
            {view.ageYears != null && (
              <Badge tone="neutral">Age: {view.ageYears}</Badge>
            )}
            <Badge tone="neutral">Completion: {view.completion}%</Badge>
          </div>
          {profile?.statusReason && (
            <p className="mt-2 text-sm text-destructive">
              Reason: {profile.statusReason}
            </p>
          )}
          {profile?.profileStatus === "approved" && (
            <p className="mt-2 text-sm text-green-800">
              Your profile is locked because it was approved.
            </p>
          )}
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={view.completion}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-all"
              style={{ width: `${view.completion}%` }}
            />
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <CardTitle className="text-base">
          {profile ? "Edit profile" : "Create your profile"}
        </CardTitle>
        <CardDescription>
          Only the display name and at least one position are required. The
          more you fill in, the easier the organizers can place you.
        </CardDescription>
        <div className="mt-4">
          <ProfileForm
            initial={
              profile
                ? {
                    displayName: profile.displayName,
                    dateOfBirth: profile.dateOfBirth,
                    heightCm: profile.heightCm,
                    positions: profile.positions,
                    skillLevel: profile.skillLevel,
                    experience: profile.experience,
                    bio: profile.bio,
                  }
                : null
            }
          />
        </div>
      </Card>

      {(user.role === "captain" || user.role === "organizer") && (
        <DraftStatusCard userId={user.id} role={user.role} />
      )}
    </div>
  );
}

const DRAFT_STATUS_LABEL = {
  setup: { tone: "warning", label: "Setup" },
  active: { tone: "success", label: "Live" },
  paused: { tone: "warning", label: "Paused" },
  completed: { tone: "neutral", label: "Completed" },
} as const;

/** Captain/organizer shortcut into the draft room with live status. */
async function DraftStatusCard({
  userId,
  role,
}: {
  userId: string;
  role: "captain" | "organizer";
}) {
  const [latest, current] = await Promise.all([
    getLatestDraft(),
    getCurrentDraft(),
  ]);
  if (!latest) return null;

  const assignments = await listDraftAssignments(latest.id);
  const mine = assignments.find((a) => a.captainUserId === userId);
  const turn =
    latest.id === current?.id ? await getDraftTurn(latest.id) : null;
  const myTurn = turn?.captainUserId === userId;
  const badge = DRAFT_STATUS_LABEL[latest.status];

  return (
    <Card className="mt-6">
      <CardTitle className="text-base">
        Draft {latest.status === "completed" ? "results" : "room"}
      </CardTitle>
      <CardDescription>
        {role === "organizer"
          ? "Manage the live draft, rosters, and picks."
          : mine
            ? `You captain ${mine.teamName} (pick #${mine.draftOrder}).`
            : "You are not assigned to a team in this draft."}
      </CardDescription>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {myTurn && <Badge tone="brand">Your pick right now</Badge>}
        <Link
          href="/draft"
          className="text-sm font-medium text-brand-700 hover:underline"
        >
          Open draft room →
        </Link>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-4 px-4 py-10 sm:px-6">
          <div className="h-8 w-64 animate-pulse rounded" />
          <div className="h-40 animate-pulse rounded-lg border border-border bg-card" />
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
