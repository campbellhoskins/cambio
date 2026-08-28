import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CAMBIO_E2E_PORT ?? 3210);

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `rm -rf e2e/.data && mkdir -p e2e/.data && CAMBIO_TEST_MODE=1 CAMBIO_PORT=${port} CAMBIO_SQLITE_PATH=e2e/.data/cambio-e2e.sqlite pnpm start`,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
