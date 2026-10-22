import { Badge } from "@/components/ui/badge";
import type { AuditEntry } from "@/features/publications/publication-service";

/**
 * Organizer audit history (Phase 7): newest-first list of recorded actions
 * with actor identity (email masked upstream in the service). Read-only by
 * design — the audit trail is append-only server-side.
 */
export function AuditPanel({ entries }: { entries: AuditEntry[] }) {
  return (
    <section className="mt-10" data-testid="audit-panel">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Audit history</h2>
        <Badge tone="neutral">{entries.length}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Who changed the league — approvals, team edits, draft transitions,
        picks, and publication.
      </p>
      {entries.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No recorded actions yet.
        </p>
      ) : (
        <ol
          className="mt-4 max-h-96 space-y-1 overflow-y-auto rounded-lg border border-border bg-card p-3"
        >
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-baseline gap-x-2 text-sm"
            >
              <time
                className="text-xs text-muted-foreground"
                dateTime={entry.createdAt.toISOString()}
              >
                {entry.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </time>
              <span className="font-mono text-xs">{entry.action}</span>
              <span className="text-muted-foreground">
                {entry.actorName ?? "System"}
                {entry.actorEmail ? ` (${entry.actorEmail})` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
