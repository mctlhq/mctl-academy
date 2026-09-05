import { defineConfig } from "@playwright/test";

// Browser regressions over the built client. Tests stub authentication only;
// question selection, persistence, rendering and navigation use the real app.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "learning-progress.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8091", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: {
    command:
      "npm run build --prefix client && npm run preview --prefix client -- --host 127.0.0.1 --port 8091 --strictPort",
    url: "http://127.0.0.1:8091",
    timeout: 120000,
  },
});
