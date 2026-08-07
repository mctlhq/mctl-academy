import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Minimal Vite + React + TypeScript scaffold for the mock exam screen
// (issue #20). See ../CLAUDE.md and the proposal under
// platform-gitops/agents-state/mctl-academy/proposals/
// issue-20-feat-ui-implement-mock-exam-screen-30-qu/ for scope.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
