import { requireRole } from "@/lib/auth/guards";
import {
  listApprovedProfiles,
  listPendingProfiles,
} from "@/features/approvals/approval-service";
import {
  getCurrentDraft,
  getDraftReadiness,
  listCaptainCandidates,
  listDraftAssignments,
} from "@/features/drafts/draft-service";
import { listTeams } from "@/features/teams/team-service";
import { listAuditEntries } from "@/features/publications/publication-service";
import {
  ApprovedPlayerRow,
  PendingProfileCard,
} from "@/components/organizer/queue";
import { TeamsPanel, type TeamEntry } from "@/components/organizer/teams-panel";
import { DraftPanel } from "@/components/organizer/draft-panel";
import { AuditPanel } from "@/components/organizer/audit-panel";
import { Badge } from "@/components/ui/badge";
import { Suspense } from "react";

/**
 * Organizer console: pending-profile review queue with approve/reject and
 * the approved roster with draft-eligibility toggles, plus team/draft
 * setup (Phase 4). Access is restricted to the organizer role and
 * re-verified on every request.
 */
async function OrganizerContent() {
  const user = await requireRole(["organizer"]);
  const [pending, approved, leagueTeams, draft, candidates, audit] =
    await Promise.all([
      listPendingProfiles(),
      listApprovedProfiles(),
      listTeams(),
      getCurrentDraft(),
      listCaptainCandidates(),
      listAuditEntries(
        // requireRole(["organizer"]) already enforced the role above.
        { id: user.id, role: user.role ?? "organizer" },
        50,
      ),
    ]);

  const assignments = draft ? await listDraftAssignments(draft.id) : [];
  const readiness = draft ? await getDraftReadiness(draft.id) : null;

  const entries: TeamEntry[] = leagueTeams.map((team) => {
    const assignment = assignments.find((a) => a.teamId === team.id);
    return {
      teamId: team.id,
      teamName: team.name,
      captainUserId: assignment?.captainUserId ?? null,
      captainName: assignment?.captainName ?? null,
      draftOrder: assignment?.draftOrder ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Organizer console</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review players, then manage teams and the draft.
          </p>
        </div>
        <Badge tone="brand">Signed in as {user.email}</Badge>
      </div>

      <section className="mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Pending approvals</h2>
          <Badge tone={pending.length > 0 ? "warning" : "neutral"}>
            {pending.length}
          </Badge>
        </div>
        <div className="mt-4 space-y-4">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No profiles waiting for review.
            </p>
          ) : (
            pending.map((entry) => (
              <PendingProfileCard key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </section>

      <section className="mt-10">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Approved players</h2>
          <Badge tone="neutral">{approved.length}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Draft eligibility controls who captains can pick.
        </p>
        <div className="mt-4 space-y-3">
          {approved.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No approved players yet.
            </p>
          ) : (
            approved.map((entry) => (
              <ApprovedPlayerRow key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </section>

      <section className="mt-10 grid items-start gap-4 lg:grid-cols-2">
        <TeamsPanel
          entries={entries}
          candidates={candidates}
          draftId={draft?.id ?? null}
          draftStatus={draft?.status ?? "none"}
        />
        <DraftPanel draft={draft} readiness={readiness} />
      </section>

      <AuditPanel entries={audit.ok ? audit.entries : []} />
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
