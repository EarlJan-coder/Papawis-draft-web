import { z } from "zod";
import { BASKETBALL_POSITIONS, SKILL_LEVELS } from "./constants";

/**
 * Server-side validation for player profile submissions (Phase 3).
 *
 * Every profile mutation (create or edit) parses through `profileInputSchema`
 * before touching the database — the client form is UX only. The database
 * constraints in `src/db/schema/players.ts` mirror these rules as a second
 * line of defense.
 *
 * Product call: only `displayName` and at least one `position` are required
 * to submit for approval; everything else is optional and contributes to the
 * completion percentage shown on the dashboard.
 */

export const MAX_BIO_LENGTH = 500;
export const MAX_EXPERIENCE_LENGTH = 300;
export const MAX_DISPLAY_NAME_LENGTH = 60;

/** Today's date as a YYYY-MM-DD string (UTC), for past-date checks. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Raw HTML form fields arrive as strings; empty text inputs come through as
 * "" and must mean "not provided" rather than a validation error.
 */
function emptyToUndefined(value: unknown): unknown {
  return value === "" || value === null ? undefined : value;
}

function optionalText(max: number) {
  return z.preprocess(
    emptyToUndefined,
    z.string().trim().max(max).optional(),
  );
}

export const profileInputSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(2, "Display name is required.")
    .max(MAX_DISPLAY_NAME_LENGTH),
  positions: z
    .array(z.enum(BASKETBALL_POSITIONS))
    .transform((list) => [...new Set(list)])
    .refine((list) => list.length >= 1, {
      message: "Pick at least one position.",
    }),
  dateOfBirth: z.preprocess(
    emptyToUndefined,
    z.iso
      .date({ message: "Date of birth must be a real date (YYYY-MM-DD)." })
      .optional()
      .refine((dob) => dob === undefined || dob <= todayIso(), {
        message: "Date of birth cannot be in the future.",
      }),
  ),
  heightCm: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ message: "Height must be a number of centimeters." })
      .int("Height must be a whole number of centimeters.")
      .min(100)
      .max(260)
      .optional(),
  ),
  skillLevel: z.preprocess(emptyToUndefined, z.enum(SKILL_LEVELS).optional()),
  experience: optionalText(MAX_EXPERIENCE_LENGTH),
  bio: optionalText(MAX_BIO_LENGTH),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

/**
 * Age in full years as of `today`, derived from an ISO date of birth.
 * `today` is injectable so tests are deterministic.
 */
export function computeAgeYears(
  dateOfBirth: string,
  today: Date = new Date(),
): number {
  const [year, month, day] = dateOfBirth.split("-").map(Number);
  let age = today.getFullYear() - year;
  const todayMonth = today.getMonth() + 1;
  const todayDay = today.getDate();
  if (todayMonth < month || (todayMonth === month && todayDay < day)) {
    age -= 1;
  }
  return age;
}

/**
 * Completion percentage (0–100, rounded) across the seven profile fields:
 * display name, date of birth, height, positions, skill level, experience,
 * bio. Display name and positions are required, so a submitted profile
 * starts above zero.
 */
export function computeProfileCompletion(profile: {
  displayName?: string | null;
  positions?: readonly string[] | null;
  dateOfBirth?: string | null;
  heightCm?: number | null;
  skillLevel?: string | null;
  experience?: string | null;
  bio?: string | null;
}): number {
  const filled = [
    hasText(profile.displayName),
    hasText(profile.dateOfBirth),
    hasText(profile.experience),
    hasText(profile.bio),
    profile.heightCm != null,
    (profile.positions?.length ?? 0) > 0,
    hasText(profile.skillLevel),
  ].filter(Boolean).length;
  return Math.round((filled / 7) * 100);
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
