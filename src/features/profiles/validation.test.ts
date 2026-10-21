import { describe, expect, it } from "vitest";
import {
  computeAgeYears,
  computeProfileCompletion,
  profileInputSchema,
} from "./validation";

/**
 * Profile input validation contract (Phase 3).
 * The break these catch: any relaxation of server-side validation — a bad
 * position, out-of-range height, or future DOB reaching the database.
 *
 * Hand-derived expectations; no builders shared with production code.
 */
describe("profileInputSchema", () => {
  const minimal = {
    displayName: "Marcus Rivera",
    positions: ["PG"],
  };

  it("accepts a minimal profile (display name + one position)", () => {
    const result = profileInputSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated profile", () => {
    const result = profileInputSchema.safeParse({
      displayName: "Aaliyah Brooks",
      positions: ["SG", "SF"],
      dateOfBirth: "2000-06-15",
      heightCm: 183,
      skillLevel: "advanced",
      experience: "Played 3 seasons of intramural ball.",
      bio: "Two-way guard. Hustles on defense, knockdown corner three.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a display name that is blank after trimming", () => {
    const result = profileInputSchema.safeParse({ ...minimal, displayName: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects a display name longer than 60 characters", () => {
    const result = profileInputSchema.safeParse({
      ...minimal,
      displayName: "x".repeat(61),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown position", () => {
    const result = profileInputSchema.safeParse({ ...minimal, positions: ["PG", "XX"] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty position list", () => {
    const result = profileInputSchema.safeParse({ ...minimal, positions: [] });
    expect(result.success).toBe(false);
  });

  it("deduplicates repeated positions", () => {
    const result = profileInputSchema.safeParse({
      ...minimal,
      positions: ["PG", "PG", "SG"],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.positions).toEqual(["PG", "SG"]);
  });

  it("accepts boundary heights 100 and 260 and rejects 99 and 261", () => {
    expect(profileInputSchema.safeParse({ ...minimal, heightCm: 100 }).success).toBe(true);
    expect(profileInputSchema.safeParse({ ...minimal, heightCm: 260 }).success).toBe(true);
    expect(profileInputSchema.safeParse({ ...minimal, heightCm: 99 }).success).toBe(false);
    expect(profileInputSchema.safeParse({ ...minimal, heightCm: 261 }).success).toBe(false);
  });

  it("rejects a non-integer height", () => {
    const result = profileInputSchema.safeParse({ ...minimal, heightCm: 175.5 });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown skill level", () => {
    const result = profileInputSchema.safeParse({ ...minimal, skillLevel: "legendary" });
    expect(result.success).toBe(false);
  });

  it("rejects a future date of birth", () => {
    const result = profileInputSchema.safeParse({
      ...minimal,
      dateOfBirth: "2030-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed date of birth", () => {
    const result = profileInputSchema.safeParse({
      ...minimal,
      dateOfBirth: "banana",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a bio longer than 500 characters", () => {
    const result = profileInputSchema.safeParse({ ...minimal, bio: "y".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("treats empty-string optional fields as absent (raw form data)", () => {
    const result = profileInputSchema.safeParse({
      ...minimal,
      dateOfBirth: "",
      heightCm: "",
      skillLevel: "",
      experience: "",
      bio: "",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.heightCm).toBeUndefined();
      expect(result.data.dateOfBirth).toBeUndefined();
      expect(result.data.skillLevel).toBeUndefined();
      expect(result.data.experience).toBeUndefined();
      expect(result.data.bio).toBeUndefined();
    }
  });

  it("coerces a numeric-string height from form input", () => {
    const result = profileInputSchema.safeParse({ ...minimal, heightCm: "183" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.heightCm).toBe(183);
  });

  it("rejects a non-numeric height string", () => {
    const result = profileInputSchema.safeParse({ ...minimal, heightCm: "tall" });
    expect(result.success).toBe(false);
  });
});

describe("computeAgeYears", () => {
  // today fixed at 2026-10-21 so every expectation is hand-checked.
  const today = new Date("2026-10-21T12:00:00Z");

  it("counts full years lived", () => {
    expect(computeAgeYears("1990-05-04", today)).toBe(36);
  });

  it("counts the birthday reached earlier this year", () => {
    expect(computeAgeYears("2000-01-01", today)).toBe(26);
  });

  it("does not count a birthday that has not happened yet this year", () => {
    expect(computeAgeYears("1998-12-31", today)).toBe(27);
  });

  it("is zero on the day of birth", () => {
    expect(computeAgeYears("2026-10-21", today)).toBe(0);
  });
});

describe("computeProfileCompletion", () => {
  it("reports 100 when all seven profile fields are filled", () => {
    expect(
      computeProfileCompletion({
        displayName: "Aaliyah Brooks",
        positions: ["SG"],
        dateOfBirth: "2000-06-15",
        heightCm: 183,
        skillLevel: "advanced",
        experience: "3 seasons",
        bio: "Guard",
      }),
    ).toBe(100);
  });

  it("reports 29 for a minimal profile (2 of 7 fields, rounded)", () => {
    expect(
      computeProfileCompletion({ displayName: "Marcus Rivera", positions: ["PG"] }),
    ).toBe(29);
  });

  it("treats blank strings as unfilled", () => {
    expect(
      computeProfileCompletion({
        displayName: "Marcus Rivera",
        positions: ["PG"],
        bio: "   ",
        experience: "",
      }),
    ).toBe(29);
  });
});
