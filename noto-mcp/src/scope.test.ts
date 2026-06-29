import { describe, expect, it } from "vitest";
import { normalizeRemote, detectScope } from "./scope.ts";

describe("normalizeRemote", () => {
  it("normalizes ssh and https GitHub remotes to a stable key", () => {
    expect(normalizeRemote("git@github.com:Acme/Widgets.git")).toBe("github.com/acme/widgets");
    expect(normalizeRemote("https://github.com/Acme/Widgets.git")).toBe("github.com/acme/widgets");
    expect(normalizeRemote("https://user:tok@gitlab.com/g/p")).toBe("gitlab.com/g/p");
  });
  it("returns null for empty input", () => {
    expect(normalizeRemote("")).toBeNull();
  });
});

describe("detectScope", () => {
  it("uses the git remote when available", () => {
    const scope = detectScope("/repo", () => "git@github.com:Acme/Widgets.git\n");
    expect(scope).toBe("github.com/acme/widgets");
  });
  it("falls back to a stable cwd key when there is no remote", () => {
    const a = detectScope("/Users/me/proj", () => { throw new Error("no remote"); });
    const b = detectScope("/Users/me/proj", () => { throw new Error("no remote"); });
    expect(a).toBe(b);
    expect(a.startsWith("cwd:")).toBe(true);
  });
});
