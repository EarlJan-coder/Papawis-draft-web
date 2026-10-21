/**
 * Player-profile domain constants. Kept free of database imports so client
 * components (the profile form) can use them without pulling Drizzle into
 * the browser bundle. `src/db/schema/players.ts` mirrors the position list
 * in its database constraints.
 */

export const BASKETBALL_POSITIONS = ["PG", "SG", "SF", "PF", "C"] as const;

export const SKILL_LEVELS = [
  "beginner",
  "intermediate",
  "advanced",
  "elite",
] as const;
