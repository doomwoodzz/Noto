import { defineConfig } from "vitest/config";

// Dedicated test config (kept separate from vite.config.ts so the React plugin
// and multi-page build don't load for Node-based unit/integration tests).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
    // Env for the server integration tests. The unit tests ignore these.
    env: {
      NODE_ENV: "test",
      DATABASE_PATH: ":memory:",
      SESSION_SECRET: "test-session-secret-at-least-32-chars-long",
      APP_ORIGIN: "http://localhost:5173",
    },
  },
});
