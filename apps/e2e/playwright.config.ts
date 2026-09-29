import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @bingo/api start",
      url: "http://localhost:3001/health",
      cwd: "../..",
      env: { E2E_TEST_MODE: "1", PORT: "3001" },
      // Nie eine bereits laufende API-Instanz wiederverwenden (z. B. `pnpm dev:api`):
      // eine solche Instanz läuft ohne E2E_TEST_MODE=1 und hat die /e2e/login/*-Routen
      // nicht registriert, was zu verwirrenden Timeouts statt eines klaren Fehlers führt.
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "pnpm --filter @bingo/web dev",
      url: "http://localhost:5173",
      cwd: "../..",
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
