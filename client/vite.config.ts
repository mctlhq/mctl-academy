/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Practice mode is a standalone, server-free static build: no backend, no
// database, no auth (see requirements.md "Out of scope"). The content bundle
// it reads is produced ahead of time by scripts/build-content-bundle.mjs,
// wired in as prebuild/pretest in package.json.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setup-tests.ts"],
    globals: false,
  },
});
