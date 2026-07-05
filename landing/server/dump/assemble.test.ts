import { describe, it, expect } from "vitest";
import { assembleNoteBody, buildMocBody, mocMembers } from "./assemble.ts";
import type { ShapedNote } from "./types.ts";
import { parseProvenanceMarker } from "../../src/noto-core/provenance.ts";

function shaped(over: Partial<ShapedNote> = {}): ShapedNote {
  return {
    notePath: "Dump/acme/Readme.md",
    title: "Readme",
    summary: "Project overview.",
    tags: ["docs", "intro"],
    links: ["Architecture", "Setup"],
    body: "First paragraph.\n\nSecond paragraph.",
    origin: { type: "github", repo: "acme/repo", path: "README.md", ref: "abc123" },
    ...over,
  };
}

describe("assembleNoteBody", () => {
  it("produces title, summary blockquote, body, Related links, marker, tags — in order", () => {
    const body = assembleNoteBody(shaped(), ["Architecture", "Setup"], 1700000000000);
    expect(body).toContain("# Readme\n\n> Project overview.\n\nFirst paragraph.");
    expect(body).toContain("## Related\n- [[Architecture]]\n- [[Setup]]");
    // marker is the LAST structural element before the tag line; provenance parses from the tail.
    const p = parseProvenanceMarker(body);
    expect(p?.type).toBe("github");
    expect(p?.repo).toBe("acme/repo");
    expect(p?.untrusted).toBe(true);
    // tags rendered as a trailing hashtag line
    expect(body.trimEnd().endsWith("#docs #intro")).toBe(true);
    // Related comes before the marker; marker before tags
    expect(body.indexOf("## Related")).toBeLessThan(body.indexOf("<!-- noto:source"));
    expect(body.indexOf("<!-- noto:source")).toBeLessThan(body.lastIndexOf("#docs"));
  });

  it("omits the summary blockquote when summary is empty", () => {
    const body = assembleNoteBody(shaped({ summary: "" }), [], 1);
    expect(body).not.toContain("\n> ");
    expect(body).toContain("# Readme\n\nFirst paragraph.");
  });

  it("omits the Related section when there are no resolved links", () => {
    const body = assembleNoteBody(shaped(), [], 1);
    expect(body).not.toContain("## Related");
  });

  it("omits the trailing tag line when there are no tags", () => {
    const body = assembleNoteBody(shaped({ tags: [] }), ["Setup"], 1);
    expect(body).not.toMatch(/#\w/);
    // still ends with the provenance marker as the last line
    expect(body.trimEnd().endsWith("-->")).toBe(true);
  });

  it("uses the RESOLVED links arg, not shaped.links (resolution happens upstream)", () => {
    // shaped.links has two candidates; only one resolved
    const body = assembleNoteBody(shaped(), ["Setup"], 1);
    expect(body).toContain("- [[Setup]]");
    expect(body).not.toContain("[[Architecture]]");
  });
});

describe("buildMocBody", () => {
  it("renders an index header with member links and a deterministic stamp", () => {
    const body = buildMocBody("acme-repo", ["Readme", "Architecture"], 1700000000000);
    expect(body.startsWith("# acme-repo — Index\n\n> Source index · 2 notes · Last updated ")).toBe(true);
    expect(body).toContain("- [[Readme]]\n- [[Architecture]]");
  });

  it("pluralizes the member count: singular for one member, plural otherwise", () => {
    const single = buildMocBody("acme-repo", ["Readme"], 1700000000000);
    expect(single).toContain("· 1 note ·");
    expect(single).not.toContain("· 1 notes ·");
    const many = buildMocBody("acme-repo", ["Readme", "Architecture", "Setup"], 1700000000000);
    expect(many).toContain("· 3 notes ·");
  });

  it("does not call Date.now — same input yields identical output", () => {
    const a = buildMocBody("s", ["A"], 42);
    const b = buildMocBody("s", ["A"], 42);
    expect(a).toBe(b);
    expect(a).toContain("· 1 note ·");
  });
});

describe("mocMembers", () => {
  it("parses the [[links]] from an existing MOC body (order-preserving, deduped)", () => {
    const body = buildMocBody("s", ["A", "B", "A"], 1);
    expect(mocMembers(body)).toEqual(["A", "B"]);
  });

  it("returns [] for a MOC body with no links", () => {
    expect(mocMembers("# s — Index\n\n> Source index · 0 notes · Last updated x\n")).toEqual([]);
  });
});
