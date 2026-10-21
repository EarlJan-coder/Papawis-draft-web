import path from "node:path";
import { defineConfig } from "vitest/config";
import {
  loadDotEnv,
  resolveTestDatabaseUrl,
} from "./tests/setup/test-db-url";

loadDotEnv();

// Resolve the test database once, at config load. When .env is missing this
// stays undefined: unit tests still run, DB-backed tests fail with a clear
// "DATABASE_URL is not set" error instead of blocking the whole config.
let testDatabaseUrl: string | undefined;
try {
  testDatabaseUrl = resolveTestDatabaseUrl();
} catch {
  // Intentionally left undefined; see note above.
}

const testEnv: Record<string, string> = {
  NODE_ENV: "test",
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET ||
    "vitest-better-auth-secret-0123456789abcdefghijklmnop",
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
};
if (testDatabaseUrl) {
  testEnv.DATABASE_URL = testDatabaseUrl;
  testEnv.TEST_DATABASE_URL = testDatabaseUrl;
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Integration tests share a real PostgreSQL database; keep them serial-safe
    // by default and let files opt into parallelism.
    fileParallelism: false,
    testTimeout: 30_000,
    globalSetup: ["tests/setup/global-setup.ts"],
    env: testEnv,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
