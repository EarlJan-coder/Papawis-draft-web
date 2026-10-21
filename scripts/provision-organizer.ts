import { provisionOrganizer } from "../src/features/admin/provision-organizer";

/**
 * CLI wrapper for controlled organizer provisioning.
 *
 * Usage:
 *   npm run provision:organizer -- <email>
 *   (or set SEED_ORGANIZER_EMAIL in .env and run `npm run provision:organizer`)
 *
 * See src/features/admin/provision-organizer.ts for the actual logic.
 */
async function main() {
  const email = process.argv[2] ?? process.env.SEED_ORGANIZER_EMAIL ?? "";

  if (!email.trim()) {
    console.error(
      'Usage: npm run provision:organizer -- <email>  (or set SEED_ORGANIZER_EMAIL)',
    );
    process.exit(1);
  }

  const result = await provisionOrganizer(email);

  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(
    result.status === "provisioned"
      ? `✓ ${email.trim().toLowerCase()} is now an organizer.`
      : `${email.trim().toLowerCase()} is already an organizer. Nothing to do.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Provisioning failed:", err);
  process.exit(1);
});
