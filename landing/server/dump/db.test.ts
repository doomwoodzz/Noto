import { describe, it, expect } from "vitest";
import { db } from "../db.ts";

describe("dump migrations", () => {
  it("creates the four dump tables", () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain("dump_jobs");
    expect(names).toContain("dump_items");
    expect(names).toContain("dump_sources");
    expect(names).toContain("connector_tokens");
  });
});
