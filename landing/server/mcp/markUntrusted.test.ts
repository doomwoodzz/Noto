import { describe, it, expect } from "vitest";
import { markUntrustedResults } from "./markUntrusted.ts";

describe("markUntrustedResults", () => {
  it("flags a result whose path is under Dump/", () => {
    const out = markUntrustedResults([
      { fileId: "a", title: "Readme", path: "Dump/acme/Readme.md", snippet: "x" },
    ]);
    expect(out[0].untrusted).toBe(true);
    expect(typeof out[0].untrustedNote).toBe("string");
    expect(out[0].untrustedNote).toMatch(/untrusted/i);
    // original fields are preserved
    expect(out[0].fileId).toBe("a");
    expect(out[0].path).toBe("Dump/acme/Readme.md");
  });

  it("does not flag a normal note", () => {
    const out = markUntrustedResults([
      { fileId: "b", title: "Biology", path: "Notes/Biology.md", snippet: "y" },
    ]);
    expect(out[0].untrusted).toBeUndefined();
    expect(out[0].untrustedNote).toBeUndefined();
  });

  it("does not flag when path is missing", () => {
    const out = markUntrustedResults([{ fileId: "c", title: "No path" }]);
    expect(out[0].untrusted).toBeUndefined();
  });

  it("does not flag a Dump substring that is not a path prefix", () => {
    const out = markUntrustedResults([{ path: "Notes/My Dump/x.md" }]);
    expect(out[0].untrusted).toBeUndefined();
  });

  it("returns a new array and preserves order + length", () => {
    const input = [{ path: "Dump/a/x.md" }, { path: "Notes/y.md" }];
    const out = markUntrustedResults(input);
    expect(out).toHaveLength(2);
    expect(out).not.toBe(input);
    expect(out[0].untrusted).toBe(true);
    expect(out[1].untrusted).toBeUndefined();
  });

  it("is idempotent — re-tagging an already-tagged result adds nothing new", () => {
    const once = markUntrustedResults([{ path: "Dump/a.md" }]);
    const twice = markUntrustedResults(once);
    expect(twice).toHaveLength(1);
    expect(twice[0].untrusted).toBe(true);
    expect(twice[0].untrustedNote).toMatch(/untrusted/i);
  });
});
