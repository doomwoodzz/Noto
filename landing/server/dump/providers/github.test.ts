import { describe, it, expect } from "vitest";
import { isProsePath, makeGithubProvider, type GhClient } from "./github.ts";
import type { FetchCtx } from "../types.ts";

describe("isProsePath", () => {
  it("includes README, top-level .md, and docs/**", () => {
    expect(isProsePath("README.md")).toBe(true);
    expect(isProsePath("README")).toBe(true);
    expect(isProsePath("guide.md")).toBe(true);
    expect(isProsePath("docs/architecture.md")).toBe(true);
    expect(isProsePath("docs/sub/deep.markdown")).toBe(true);
  });
  it("excludes code, binaries, lockfiles, and dotfiles", () => {
    expect(isProsePath("src/index.ts")).toBe(false);
    expect(isProsePath("logo.png")).toBe(false);
    expect(isProsePath("package-lock.json")).toBe(false);
    expect(isProsePath("docs/diagram.svg")).toBe(false);
    expect(isProsePath(".github/workflows/ci.yml")).toBe(false);
  });
  it("honors an explicit glob (e.g. notes/**) on top of the prose defaults", () => {
    expect(isProsePath("notes/2026/jan.md", "notes/**")).toBe(true);
    expect(isProsePath("notes/2026/data.csv", "notes/**")).toBe(false); // glob widens path scope, not file types
  });
});

describe("github provider", () => {
  const tree = [
    { path: "README.md", type: "blob", sha: "r1" },
    { path: "docs/intro.md", type: "blob", sha: "d1" },
    { path: "docs/api.md", type: "blob", sha: "d2" },
    { path: "src/index.ts", type: "blob", sha: "s1" }, // excluded
    { path: "logo.png", type: "blob", sha: "p1" },      // excluded
  ];
  const contents: Record<string, string> = {
    "README.md": "# Acme\n\nHello.",
    "docs/intro.md": "# Intro\n\nStart here.",
    "docs/api.md": "# API\n\nEndpoints.",
  };
  function fakeClient(overrides: Partial<GhClient> = {}): GhClient {
    return {
      mintToken: async () => "ghs_test",
      getRepo: async () => ({ default_branch: "main" }),
      getTree: async () => ({ tree, truncated: false }),
      getBlob: async (_token, _repo, path) => ({ contentB64: Buffer.from(contents[path] ?? "").toString("base64") }),
      listIssues: async () => [],
      ...overrides,
    };
  }
  function ctx(cap: number): FetchCtx {
    return { userId: "u1", sourceRef: { repo: "acme/widgets" }, cap, onProgress: () => {} };
  }

  it("yields one RawItem per prose file, code/binaries excluded, in path-sorted order", async () => {
    const provider = makeGithubProvider(fakeClient());
    const items = await provider.fetch(ctx(100));
    expect(items.map((i) => i.origin.path)).toEqual(["README.md", "docs/api.md", "docs/intro.md"]);
    expect(items[0].body).toBe("# Acme\n\nHello.");
    expect(items[0].sourceKey).toBe("github:acme/widgets:README.md");
    expect(items[0].origin).toMatchObject({ type: "github", repo: "acme/widgets", ref: "r1", path: "README.md" });
    expect(items[0].origin.url).toBe("https://github.com/acme/widgets/blob/r1/README.md");
  });

  it("respects ctx.cap (stops after `cap` prose items, deterministic order)", async () => {
    const provider = makeGithubProvider(fakeClient());
    const items = await provider.fetch(ctx(2));
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.origin.path)).toEqual(["README.md", "docs/api.md"]);
  });

  it("includes issues as RawItems when includeIssues is set", async () => {
    const provider = makeGithubProvider(
      fakeClient({
        listIssues: async () => [
          { number: 7, title: "Bug: crash", body: "steps", html_url: "https://github.com/acme/widgets/issues/7", updated_at: "2026-01-02T00:00:00Z" },
        ],
      }),
    );
    const items = await provider.fetch({ userId: "u1", sourceRef: { repo: "acme/widgets", includeIssues: true }, cap: 100, onProgress: () => {} });
    const issue = items.find((i) => i.title.includes("Bug: crash"));
    expect(issue).toBeDefined();
    expect(issue!.sourceKey).toBe("github:acme/widgets#7");
    expect(issue!.origin.url).toBe("https://github.com/acme/widgets/issues/7");
  });

  it("skips a failed blob fetch but keeps the others (partial failure)", async () => {
    const provider = makeGithubProvider(
      fakeClient({
        getBlob: async (_t, _r, path) => {
          if (path === "docs/api.md") throw new Error("500");
          return { contentB64: Buffer.from(contents[path] ?? "").toString("base64") };
        },
      }),
    );
    const items = await provider.fetch(ctx(100));
    expect(items.map((i) => i.origin.path)).toEqual(["README.md", "docs/intro.md"]);
  });

  it("throws when every prose blob fails (systemic failure, not an empty dump)", async () => {
    const provider = makeGithubProvider(
      fakeClient({ getBlob: async () => { throw new Error("500"); } }),
    );
    await expect(provider.fetch(ctx(100))).rejects.toThrow(/all .* content file/i);
  });
});
