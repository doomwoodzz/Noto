import { describe, expect, it } from "vitest";
import { assignGroups, defaultFolderGroups, matchGroup } from "./webGroups";
import { PALETTE, UNGROUPED_COLOR, type WebGroup, type WebNode } from "./webTypes";

function node(partial: Partial<WebNode> & { id: string; title: string; path: string }): WebNode {
  return { folder: partial.path.split("/")[0], deg: 0, ins: 0, outs: 0, snippet: "", nb: [], ...partial };
}

describe("matchGroup", () => {
  const n = node({ id: "1", title: "Chloroplast", path: "Biology/Chloroplast.md" });

  it("matches path: prefix case-insensitively", () => {
    expect(matchGroup("path:Biology", n)).toBe(true);
    expect(matchGroup("path:biology", n)).toBe(true);
    expect(matchGroup("path:Chemistry", n)).toBe(false);
  });

  it("matches bare text against the title (contains)", () => {
    expect(matchGroup("chloro", n)).toBe(true);
    expect(matchGroup("PLAST", n)).toBe(true);
    expect(matchGroup("mitochondria", n)).toBe(false);
  });

  it("returns false for empty or path-only queries", () => {
    expect(matchGroup("", n)).toBe(false);
    expect(matchGroup("   ", n)).toBe(false);
    expect(matchGroup("path:", n)).toBe(false);
  });
});

describe("assignGroups", () => {
  const nodes = [
    node({ id: "a", title: "Chloroplast", path: "Biology/Chloroplast.md" }),
    node({ id: "b", title: "Covalent Bonds", path: "Chemistry/Covalent.md" }),
    node({ id: "c", title: "Loose", path: "Personal/Loose.md" }),
  ];
  const groups: WebGroup[] = [
    { query: "path:Biology", color: "#111", visible: true },
    { query: "path:Chemistry", color: "#222", visible: false },
  ];

  it("colors by first matching group and greys unmatched nodes", () => {
    const r = assignGroups(nodes, groups);
    expect(r.colors).toEqual(["#111", "#222", UNGROUPED_COLOR]);
  });

  it("marks nodes hidden only when their matched group is invisible", () => {
    const r = assignGroups(nodes, groups);
    expect(r.hidden).toEqual([false, true, false]);
  });

  it("counts members per group", () => {
    const r = assignGroups(nodes, groups);
    expect(r.counts).toEqual([1, 1]);
  });

  it("uses the first group when several match", () => {
    const overlap: WebGroup[] = [
      { query: "path:Biology", color: "#111", visible: true },
      { query: "chloro", color: "#999", visible: true },
    ];
    const r = assignGroups([nodes[0]], overlap);
    expect(r.colors[0]).toBe("#111");
    expect(r.counts).toEqual([1, 0]);
  });
});

describe("defaultFolderGroups", () => {
  it("makes one visible path: group per folder, colored round-robin", () => {
    const g = defaultFolderGroups(["Biology", "Chemistry"]);
    expect(g).toEqual([
      { query: "path:Biology", color: PALETTE[0], visible: true },
      { query: "path:Chemistry", color: PALETTE[1], visible: true },
    ]);
  });

  it("wraps the palette past its length", () => {
    const folders = Array.from({ length: PALETTE.length + 1 }, (_, i) => `F${i}`);
    const g = defaultFolderGroups(folders);
    expect(g[PALETTE.length].color).toBe(PALETTE[0]);
  });
});
