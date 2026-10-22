import { BASKETBALL_POSITIONS } from "@/db/schema";

/**
 * Position-coverage advisories (Phase 6). Pure function over a roster:
 * warnings are hints for captains, never blockers.
 */

export const POSITION_LABELS: Record<(typeof BASKETBALL_POSITIONS)[number], string> =
  {
    PG: "point guard (PG)",
    SG: "shooting guard (SG)",
    SF: "small forward (SF)",
    PF: "power forward (PF)",
    C: "center (C)",
  };

const DOMINANCE_THRESHOLD = 3;

export function positionCoverageWarnings(
  roster: { positions: string[] }[],
): string[] {
  // An empty roster is not yet a roster — no advisories.
  if (roster.length === 0) return [];

  const warnings: string[] = [];
  const counts = new Map<string, number>();

  for (const player of roster) {
    for (const raw of player.positions) {
      const position = raw.toUpperCase();
      if (!(position in POSITION_LABELS)) continue;
      counts.set(position, (counts.get(position) ?? 0) + 1);
    }
  }

  for (const position of BASKETBALL_POSITIONS) {
    const count = counts.get(position) ?? 0;
    if (count === 0) {
      warnings.push(`No ${POSITION_LABELS[position]} on the roster.`);
    } else if (count >= DOMINANCE_THRESHOLD) {
      warnings.push(`Three or more players at ${POSITION_LABELS[position]}.`);
    }
  }

  return warnings;
}
