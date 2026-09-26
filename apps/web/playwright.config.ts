import { defineConfig, devices } from "@playwright/test";

const PORT = 3334;

/**
 * E2E config. Boots the app with an isolated file store and no AI/DB credentials, so the
 * run is deterministic and offline (heuristic extraction). The mic itself can't be driven
 * headlessly, but every other part of the capture → intelligence flow is exercised.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      `DATABASE_URL= POSTGRES_URL= POSTGRES_PRISMA_URL= VERCEL_OIDC_TOKEN= AI_GATEWAY_API_KEY= OPENAI_API_KEY= ` +
      `DATA_DIR=/tmp/utahcity-e2e-data PORT=${PORT} npm run dev`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
