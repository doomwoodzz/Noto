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
      VAULT_KEY_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      // A dummy, obviously-fake key so `env.openaiConfigured` is true in tests:
      // the AI-route tests mock `openai.ts` (and the Dump tests inject enrich
      // fakes), so no request ever reaches OpenAI — this value is never used for
      // a real call, only to flip the config gate. Because dotenv runs with
      // override:false, this also shadows any real key in a local `.env`, so the
      // suite is deterministic and offline in every environment (CI included).
      OPENAI_API_KEY: "sk-test-dummy-not-a-real-key",
    },
  },
});
