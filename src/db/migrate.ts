import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { db } from "./index";

/**
 * Applies all pending Drizzle migrations.
 *
 * Usage: npm run db:migrate
 * DATABASE_URL is loaded from .env via node --env-file-if-exists.
 */
async function main() {
  const migrationsFolder = path.join(__dirname, "migrations");
  console.log(`Applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
