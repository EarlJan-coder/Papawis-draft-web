import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    // drizzle-kit generate is offline; studio/push need a real URL.
    // Prefer DATABASE_URL (loaded via --env-file in npm scripts).
    url: process.env.DATABASE_URL ?? "postgres://papawis:papawis@localhost:5433/papawis",
  },
  strict: true,
  verbose: true,
});
