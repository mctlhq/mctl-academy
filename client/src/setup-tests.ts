import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest only auto-detects @testing-library/react's afterEach cleanup when
// test.globals is enabled; this project uses explicit vitest imports
// instead, so cleanup is wired here.
afterEach(() => {
  cleanup();
});
