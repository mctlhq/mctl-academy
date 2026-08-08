import { defineConfig } from "@playwright/test";

const PORT = process.env.ACADEMY_E2E_PORT ?? "8090";
const BASE_URL = `http://localhost:${PORT}`;

// The app hard-fails without a real Postgres connection (Track B — no
// in-memory fallback), so DATABASE_URL must already point at a migrated,
// reachable database before this config's webServer boots. CI provides a
// Postgres service; locally, point at whatever `bun run migrate` targeted.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    // client build (vue-tsc + vite) must happen before the server starts,
    // since server/app.mjs serves client/dist directly with no dev proxy.
    command: "npm run build --prefix client && npm start",
    url: `${BASE_URL}/readyz`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT,
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-test-secret-not-used-in-production",
      // Deliberately NOT NODE_ENV=production: db-ssl.mjs requires SSL when
      // it's set, and neither the CI Postgres service nor a local Docker
      // Postgres terminates SSL. Static asset serving (client/dist) isn't
      // gated by NODE_ENV, so this has no effect on what's actually tested.
    },
  },
});
