import { describe, it, expect } from "vitest";
import { buildProvenanceMarker, parseProvenanceMarker } from "./provenance.ts";

describe("provenance marker", () => {
  it("round-trips origin fields", () => {
    const m = buildProvenanceMarker({ type: "github", repo: "octo/repo", path: "docs/x.md", url: "https://github.com/octo/repo/blob/abc/docs/x.md", ref: "abc" }, 1700000000000);
    expect(m.startsWith("<!-- noto:source v=1 type=github untrusted=1")).toBe(true);
    const p = parseProvenanceMarker("# Title\n\nbody\n\n" + m);
    expect(p?.type).toBe("github");
    expect(p?.repo).toBe("octo/repo");
    expect(p?.untrusted).toBe(true);
  });

  it("escapes quotes/newlines in values", () => {
    const m = buildProvenanceMarker({ type: "raw", path: 'a "weird"\npath' }, 1);
    expect(m).not.toContain("\n<"); // single line
    expect(parseProvenanceMarker(m)?.path).toBe('a "weird" path');
  });

  it("returns null when no marker present", () => {
    expect(parseProvenanceMarker("just a normal note\n")).toBeNull();
  });

  it("only scans the tail (ignores marker-like text mid-body)", () => {
    const body = "<!-- noto:source v=1 type=raw untrusted=1 -->\n" + Array(50).fill("line").join("\n");
    expect(parseProvenanceMarker(body)).toBeNull();
  });
});
