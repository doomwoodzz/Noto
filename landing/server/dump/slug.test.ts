import { describe, it, expect } from "vitest";
import { slugifySource, slugifyTitle } from "./slug.ts";

describe("slug", () => {
  it("makes a filesystem-safe source slug", () => {
    expect(slugifySource("octocat/Hello-World")).toBe("octocat-Hello-World");
    expect(slugifySource("My Workspace / Notes")).toBe("My Workspace - Notes");
    expect(slugifySource("a".repeat(100)).length).toBeLessThanOrEqual(60);
  });
  it("slugs a note title without the .md", () => {
    expect(slugifyTitle("Hello: World?")).toBe("Hello World");
    expect(slugifyTitle("  spaced  ")).toBe("spaced");
    expect(slugifyTitle("")).toBe("Untitled");
  });
});
