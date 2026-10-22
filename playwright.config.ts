import { defineConfig, devices } from "@playwright/test";
import {
  loadDotEnv,
  siblingDatabaseUrl,
} from "./tests/setup/test-db-url";

/**
 * Playwright E2E (Phase 8): one serial browser journey through the full
 * league workflow against a disposable `papawis_e2e` database on its own
 * dev-server port (3100), so it can never touch dev or vitest data.
 */

loadDotEnv();

const e2eDatabaseUrl = siblingDatabaseUrl("papawis_e2e");
// Every worker + the spec's own service imports must use the E2E database.
process.env.DATABASE_URL = e2eDatabaseUrl;
process.env.BETTER_AUTH_URL = "http://localhost:3100";

const port = 3100;
const baseURL = `http://localhost:${port}`;

/** Full process env for the web server, with the E2E overrides applied. */
function serverEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export default defineConfig({
  testDir: "./tests/e2e",
  // One shared database: the workflow must run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // First-hit dev-server compiles + 9 UI registrations + full draft flow.
  timeout: 10 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run e2e:server",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: serverEnv(),
  },
});
