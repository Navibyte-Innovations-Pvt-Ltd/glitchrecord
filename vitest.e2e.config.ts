import path from "node:path";
import { defineConfig } from "vitest/config";

// Separate config for the headed, real-browser e2e lane. Kept out of the default
// `test` run (which stays fast + CI-safe) because it launches a real Chromium
// with the extension and needs a display. Run with `bun run test:e2e`.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["e2e/**/*.e2e.test.{ts,tsx}"],
    // One browser/app at a time — the bridge + Electron bind the fixed port 7337.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
