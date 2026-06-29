import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// env.ts reads process.env at import time, so each case manipulates the
// environment and re-imports the module via vi.resetModules().
describe("env SESSION_SECRET provisioning", () => {
  let tmp: string;
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
    DATABASE_PATH: process.env.DATABASE_PATH,
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "noto-env-"));
    process.env.NODE_ENV = "production";
    process.env.DATABASE_PATH = join(tmp, "noto.sqlite");
    delete process.env.SESSION_SECRET;
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = saved.NODE_ENV;
    process.env.DATABASE_PATH = saved.DATABASE_PATH;
    if (saved.SESSION_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved.SESSION_SECRET;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("boots in production without SESSION_SECRET by auto-generating one", async () => {
    const { env } = await import("./env.ts");
    expect(typeof env.SESSION_SECRET).toBe("string");
    expect(env.SESSION_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it("persists the generated secret across restarts", async () => {
    const first = (await import("./env.ts")).env.SESSION_SECRET;
    vi.resetModules();
    const second = (await import("./env.ts")).env.SESSION_SECRET;
    expect(second).toBe(first);
  });

  it("prefers an explicitly provided SESSION_SECRET over the persisted one", async () => {
    const explicit = "explicit-session-secret-at-least-32-chars-long";
    process.env.SESSION_SECRET = explicit;
    const { env } = await import("./env.ts");
    expect(env.SESSION_SECRET).toBe(explicit);
  });
});
