import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { db } from "@/db";
import * as schema from "@/db/schema";

/**
 * Server-side Better Auth instance.
 *
 * Security notes:
 * - `role` and `status` are `input: false` additional fields: they can never
 *   be supplied or modified through any authentication endpoint (registration
 *   always lands as `player` / `active`).
 * - Organizer privileges are granted only by the `provision:organizer` script.
 * - Rate limiting is persisted in the database so it survives serverless
 *   instance recycling.
 */
export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // Email verification requires a mail provider; documented as a manual
    // production step (see README security notes).
    requireEmailVerification: false,
  },
  user: {
    additionalFields: {
      role: {
        type: ["player", "captain", "organizer"],
        required: false,
        defaultValue: "player",
        input: false, // never accepted from client input
      },
      status: {
        type: ["active", "suspended"],
        required: false,
        defaultValue: "active",
        input: false, // never accepted from client input
      },
    },
  },
  rateLimit: {
    // On in dev + production (brute-force / bulk-signup protection); off in
    // tests so suites are not throttled. Persisted in the database so it
    // survives serverless instance recycling.
    enabled: process.env.NODE_ENV !== "test",
    storage: "database",
    window: 60,
    max: 60,
    customRules: {
      "/sign-in": { window: 60, max: 15 },
      "/sign-up": { window: 60, max: 15 },
    },
  },
  advanced: {
    database: {
      // Let PostgreSQL generate UUIDs for all auth tables.
      generateId: false,
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      ...schema,
      // Better Auth model names map to our (plural) table exports.
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      rateLimit: schema.rateLimits,
    },
  }),
});

export type Auth = typeof auth;
export type Session = Auth["$Infer"]["Session"];
export type SessionUser = Session["user"];
