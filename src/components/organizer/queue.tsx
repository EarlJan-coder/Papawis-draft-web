import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { RejectForm } from "./reject-form";
import { approveAction, toggleEligibilityAction } from "@/features/approvals/actions";
import type {
  ApprovedProfileSummary,
  PendingProfileSummary,
} from "@/features/approvals/approval-service";

/**
 * Organizer review queue (server components). Approve and eligibility are
 * plain forms over server actions; reject needs the client RejectForm for
 * its reason input and inline error. All decisions re-verify authorization
 * server-side — nothing here is trusted.
 */

function positionLine(positions: string[]): string {
  return positions.length > 0 ? positions.join(" · ") : "—";
}

export function PendingProfileCard({
  entry,
}: {
  entry: PendingProfileSummary;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{entry.displayName}</CardTitle>
          <CardDescription>
            {entry.emailMasked}
            {entry.ageYears != null ? ` · ${entry.ageYears} yrs` : ""}
            {" · "}
            {positionLine(entry.positions)}
            {entry.heightCm != null ? ` · ${entry.heightCm} cm` : ""}
            {entry.skillLevel ? ` · ${entry.skillLevel}` : ""}
          </CardDescription>
        </div>
        <form action={approveAction}>
          <input type="hidden" name="profileId" value={entry.id} />
          <Button type="submit" size="sm">
            Approve
          </Button>
        </form>
      </div>
      {(entry.experience || entry.bio) && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
          {[entry.experience, entry.bio].filter(Boolean).join("\n")}
        </p>
      )}
      <RejectForm profileId={entry.id} />
    </Card>
  );
}

export function ApprovedPlayerRow({ entry }: { entry: ApprovedProfileSummary }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">{entry.displayName}</p>
        <p className="text-xs text-muted-foreground">
          {entry.emailMasked}
          {entry.ageYears != null ? ` · ${entry.ageYears} yrs` : ""} ·{" "}
          {positionLine(entry.positions)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={entry.isDraftEligible ? "success" : "neutral"}>
          {entry.isDraftEligible ? "Draft-eligible" : "Not eligible"}
        </Badge>
        <form action={toggleEligibilityAction}>
          <input type="hidden" name="profileId" value={entry.id} />
          <input
            type="hidden"
            name="eligible"
            value={entry.isDraftEligible ? "false" : "true"}
          />
          <Button type="submit" variant="outline" size="sm">
            {entry.isDraftEligible ? "Remove eligibility" : "Make eligible"}
          </Button>
        </form>
      </div>
    </div>
  );
}
