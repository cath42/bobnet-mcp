import { defineConfig } from "vitest/config";

// A land runs every package's suite at once; under that load the git and Store fixtures here have
// outrun vitest's 5 s test and 10 s hook defaults (BOB-242's says-once test, board-service's afterEach).
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
