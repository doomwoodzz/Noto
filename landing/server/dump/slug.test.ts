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
  it("scrubs C0 control chars (NUL/BEL/ESC) that pathSchema would reject", () => {
    expect(slugifyTitle("evil\x00name")).toBe("evil name");
    expect(slugifyTitle("a\x07b\x1bc")).toBe("a b c");
    expect(slugifySource("repo\x00/path")).toBe("repo -path");
    // A title that is ONLY control chars collapses to the fallback.
    expect(slugifyTitle("\x00\x01\x02")).toBe("Untitled");
  });
  it("normalizes Unicode (NFC) so combining and precomposed titles slug identically", () => {
    const combining = "Café";   // C a f e + combining acute U+0301
    const precomposed = "Café";  // C a f é (U+00E9)
    expect(slugifyTitle(combining)).toBe(slugifyTitle(precomposed));
  });
});
