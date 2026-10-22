/**
 * Pure snake-draft ordering (Phase 5). No IO — the pick service derives
 * "whose pick is it" exclusively from here plus the stored cursor.
 *
 * A draft with T teams and R rounds has T×R picks. Round 1 picks in draft
 * order; each subsequent round reverses ("snakes"). Pick numbers are 1-based.
 */

export type SnakeOrder = {
  /** Team ids in draft order (index 0 picks first overall). */
  orderedTeamIds: string[];
};

/** Index into `orderedTeamIds` that owns the given 1-based pick number. */
export function snakeTeamIndexForPick(
  pickNumber: number,
  order: SnakeOrder,
): number {
  const teams = order.orderedTeamIds.length;
  if (teams === 0) {
    throw new Error("snake order requires at least one team");
  }
  if (!Number.isInteger(pickNumber) || pickNumber < 1) {
    throw new Error(`pick number must be a positive integer, got ${pickNumber}`);
  }

  const zeroBased = pickNumber - 1;
  const round = Math.floor(zeroBased / teams); // 0-based
  const slot = zeroBased % teams;
  return round % 2 === 0 ? slot : teams - 1 - slot;
}

/** Team id owning the given pick number. */
export function snakeTeamIdForPick(
  pickNumber: number,
  order: SnakeOrder,
): string {
  const index = snakeTeamIndexForPick(pickNumber, order);
  return order.orderedTeamIds[index]!;
}

/** Total picks in a draft of `rounds` rounds over `teamCount` teams. */
export function totalPicks(rounds: number, teamCount: number): number {
  return rounds * teamCount;
}
