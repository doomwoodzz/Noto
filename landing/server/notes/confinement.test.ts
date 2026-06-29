import { describe, expect, it } from "vitest";
import { isMemoryPath, MEMORY_PREFIX } from "./confinement.ts";

describe("isMemoryPath", () => {
  it("accepts paths inside Memory/", () => {
    expect(isMemoryPath("Memory/decisions.md")).toBe(true);
    expect(isMemoryPath("Memory/proj/log.md")).toBe(true);
    expect(MEMORY_PREFIX).toBe("Memory/");
  });
  it("rejects paths outside Memory/ (case-sensitive, no prefix games)", () => {
    expect(isMemoryPath("Notes/x.md")).toBe(false);
    expect(isMemoryPath("memory/x.md")).toBe(false);   // case
    expect(isMemoryPath("MemoryX/x.md")).toBe(false);  // not the folder
    expect(isMemoryPath("x.md")).toBe(false);
  });
  it("rejects traversal escapes even under Memory/", () => {
    expect(isMemoryPath("Memory/../secret.md")).toBe(false);
  });
});
