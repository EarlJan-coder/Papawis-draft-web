import { describe, expect, it } from "vitest";
import {
  snakeTeamIndexForPick,
  totalPicks,
  type SnakeOrder,
} from "./snake-order";

/**
 * Pure snake-order math (Phase 5). No DB, no IO — this module is the single
 * derivation the pick service trusts for "whose pick is it".
 */

const A: SnakeOrder = { orderedTeamIds: ["A", "B", "C", "D"] };

describe("snake order", () => {
  it("snakes the first two rounds for 4 teams", () => {
    const picks = [1, 2, 3, 4, 5, 6, 7, 8].map((p) =>
      snakeTeamIndexForPick(p, A),
    );
    // Round 1: A B C D. Round 2 reverses: D C B A.
    expect(picks).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
  });

  it("keeps alternating in later rounds", () => {
    const picks = [9, 10, 11, 12, 13, 14, 15, 16].map((p) =>
      snakeTeamIndexForPick(p, A),
    );
    // Round 3: A B C D. Round 4: D C B A.
    expect(picks).toEqual([0, 1, 2, 3, 3, 2, 1, 0]);
  });

  it("respects a non-default draft order", () => {
    const order: SnakeOrder = { orderedTeamIds: ["D", "C", "B", "A"] };
    expect(snakeTeamIndexForPick(1, order)).toBe(0); // D picks first
    expect(snakeTeamIndexForPick(4, order)).toBe(3); // A last in round 1
    expect(snakeTeamIndexForPick(5, order)).toBe(3); // A opens round 2
  });

  it("rejects invalid pick numbers and empty orders", () => {
    expect(() => snakeTeamIndexForPick(0, A)).toThrow();
    expect(() => snakeTeamIndexForPick(1.5, A)).toThrow();
    expect(() => snakeTeamIndexForPick(1, { orderedTeamIds: [] })).toThrow();
    // Fewer than 4 teams is still a valid snake: round 2 reverses (B, A).
    expect(snakeTeamIndexForPick(3, { orderedTeamIds: ["A", "B"] })).toBe(1);
  });

  it("computes total picks from rounds", () => {
    expect(totalPicks(8, 4)).toBe(32);
    expect(totalPicks(1, 4)).toBe(4);
  });
});
