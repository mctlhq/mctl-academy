import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Vue 3 + Vite scaffold (PLAN.md Track C / PR6). See ../CLAUDE.md and
// ../PLAN.md for scope.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
});
