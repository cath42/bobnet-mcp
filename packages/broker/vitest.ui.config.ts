import { defineConfig } from "vitest/config";

// The dashboard page, rendered in a simulated browser against a fake socket.
export default defineConfig({
  test: { environment: "happy-dom", include: ["test-ui/**/*.test.ts"] },
});
