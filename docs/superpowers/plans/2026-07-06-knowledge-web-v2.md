# Knowledge Web v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static SVG Knowledge Web with a canvas-based, force-directed interactive graph (pan/zoom/drag physics, Obsidian-style Filters/Groups/Display/Forces panel, node info card, hover previews), wired to real vault data and the app's semantic Smart Search, with per-vault persistence and a theme-aware canvas.

**Architecture:** A framework-agnostic imperative engine (`webEngine.ts`) owns the `<canvas>` and runs the physics/render/interaction loop outside React. Pure, unit-tested helpers handle grouping, adjacency/model-building, and persistence. A React shell (`KnowledgeWeb.tsx`) renders the floating panels and cards and drives the engine imperatively via a ref. `NotoWindow` builds the engine's data model from the existing `buildGraph(...)` output and bridges the existing `useSmartSearch` results into the graph as a highlight set.

**Tech Stack:** TypeScript, React 18, Vite, Vitest. Canvas 2D. No new runtime dependencies.

**Reference:** The design being ported is in the repo at `docs/superpowers/specs/assets/knowledge-web-v2.dc.html` and specified in `docs/superpowers/specs/2026-07-06-knowledge-web-v2-design.md`. All physics constants and draw math in `webEngine.ts` come from that reference file; this plan reproduces the adapted code in full.

**Working directory for all paths below:** `landing/` (the web app). Commands are run from `landing/`.

---

## File Structure

**New (all under `landing/src/workspace/graph/`):**
- `webTypes.ts` — shared types + constants (`WebNode`, `WebModel`, `WebSliders`, `WebGroup`, `WebSettings`, `WebColors`, `PALETTE`, `DEFAULT_SLIDERS`, `DARK_COLORS`).
- `webGroups.ts` — pure grouping logic (`matchGroup`, `assignGroups`, `defaultFolderGroups`). + `webGroups.test.ts`.
- `webAdjacency.ts` — pure model builder (`buildWebModel`, `topFolder`, `snippetFor`). + `webAdjacency.test.ts`.
- `webPersistence.ts` — pure localStorage load/save (`loadWebSettings`, `saveWebSettings`). + `webPersistence.test.ts`.
- `webEngine.ts` — imperative canvas engine (`WebEngine` class). No unit test; verified live.
- `KnowledgeWeb.tsx` — React shell. No unit test; verified live.

**Modified:**
- `landing/src/workspace/NotoWindow.tsx` — build the model, render `KnowledgeWeb` instead of `GraphView`, bridge Smart Search results.
- `landing/src/workspace/smartSearch/SmartSearchPanel.tsx` — add optional `onHoverResult` prop.
- `landing/src/workspace/useWorkspace.ts` — remove the retired `graphFilter` state.
- `landing/src/styles/workspace.css` — remove old `.nw-web*` rules, add `.nw-web2*` rules.

**Deleted:**
- `landing/src/workspace/GraphView.tsx`.

**Retained untouched:** `landing/src/noto-core/graph.ts` (`filterGraph` stays — Swift-parity port with tests, just loses its web caller).

---

## Task 1: Shared types + constants

**Files:**
- Create: `landing/src/workspace/graph/webTypes.ts`

- [ ] **Step 1: Create the types file**

```typescript
// Shared types + constants for the Knowledge Web canvas graph.

/** A graph node the engine renders. `id` === the vault file id. */
export interface WebNode {
  id: string;
  title: string;
  /** Top path segment, e.g. "Biology". Used for default color groups. */
  folder: string;
  path: string;
  /** degree = backlinks + outgoing (mirrors GraphNode.degree). Drives radius. */
  deg: number;
  /** backlinks count. */
  ins: number;
  /** outgoing count. */
  outs: number;
  /** Plain-text preview of the note body, for the hover card. */
  snippet: string;
  /** Neighbor indices into the WebModel.nodes array (deduped, undirected). */
  nb: number[];
}

/** Immutable data the engine is constructed from. */
export interface WebModel {
  nodes: WebNode[];
  /** Deduped undirected edges as index pairs into `nodes`. */
  links: [number, number][];
  /** Distinct top folders, in first-seen order. */
  folders: string[];
  /** Max degree (>= 1), for radius normalization. */
  maxDeg: number;
}

export interface WebSliders {
  node: number;
  link: number;
  text: number;
  center: number;
  repel: number;
  spring: number;
}

export interface WebGroup {
  /** Match expression: "path:Folder" (path prefix) or bare text (title contains). */
  query: string;
  color: string;
  visible: boolean;
}

export interface WebSettings {
  sliders: WebSliders;
  groups: WebGroup[];
}

/** Theme-derived canvas colors. RGB triplets let the engine vary alpha. */
export interface WebColors {
  background: string;
  edge: [number, number, number];
  labelDim: string;
  labelBright: string;
  accent: [number, number, number];
  ring: [number, number, number];
}

export const DEFAULT_SLIDERS: WebSliders = {
  node: 0.5,
  link: 0.35,
  text: 0.5,
  center: 0.5,
  repel: 0.5,
  spring: 0.5,
};

/** Group palette (from the design). Index 0 is the accent blue. */
export const PALETTE: string[] = [
  "#578FFA", "#5BC98B", "#F0A44B", "#E8D06B", "#B07AD6",
  "#F27D9D", "#54BFC7", "#F54740", "#8F99AE", "#9C8A6E",
];

/** Color of a node that matches no visible group. */
export const UNGROUPED_COLOR = "#5C6473";

/** Fallback colors matching the design's dark canvas (used if CSS read fails). */
export const DARK_COLORS: WebColors = {
  background: "#0c0d0f",
  edge: [143, 153, 174],
  labelDim: "#9AA4B6",
  labelBright: "#EBF0FA",
  accent: [87, 143, 250],
  ring: [235, 240, 250],
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no errors introduced by this file (pre-existing unrelated errors, if any, are out of scope).

- [ ] **Step 3: Commit**

```bash
git add landing/src/workspace/graph/webTypes.ts
git commit -m "feat(web): add Knowledge Web v2 shared types"
```

---

## Task 2: Grouping logic (TDD)

**Files:**
- Create: `landing/src/workspace/graph/webGroups.ts`
- Test: `landing/src/workspace/graph/webGroups.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace/graph/webGroups.test.ts`
Expected: FAIL — cannot resolve `./webGroups`.

- [ ] **Step 3: Write the implementation**

```typescript
// Pure grouping logic for the Knowledge Web: match expressions, per-node color/
// visibility assignment, and folder-derived default groups.

import { PALETTE, UNGROUPED_COLOR, type WebGroup, type WebNode } from "./webTypes";

/** Does `node` match a group's query? "path:X" = path starts with X; else title contains. */
export function matchGroup(query: string, node: { title: string; path: string }): boolean {
  const q = (query || "").trim().toLowerCase();
  if (!q) return false;
  if (q.indexOf("path:") === 0) {
    const p = q.slice(5).trim();
    return p ? node.path.toLowerCase().indexOf(p) === 0 : false;
  }
  return node.title.toLowerCase().indexOf(q) >= 0;
}

export interface GroupAssignment {
  /** Per-node fill color (group color or the ungrouped grey). */
  colors: string[];
  /** Per-node hidden flag (matched an invisible group). */
  hidden: boolean[];
  /** Per-group member count, aligned to the input `groups`. */
  counts: number[];
}

/** Assign each node to its first matching group. First match wins. */
export function assignGroups(nodes: WebNode[], groups: WebGroup[]): GroupAssignment {
  const counts = groups.map(() => 0);
  const colors: string[] = new Array(nodes.length);
  const hidden: boolean[] = new Array(nodes.length);
  for (let n = 0; n < nodes.length; n++) {
    let gi = -1;
    for (let i = 0; i < groups.length; i++) {
      if (matchGroup(groups[i].query, nodes[n])) {
        gi = i;
        break;
      }
    }
    colors[n] = gi >= 0 ? groups[gi].color : UNGROUPED_COLOR;
    hidden[n] = gi >= 0 && !groups[gi].visible;
    if (gi >= 0) counts[gi]++;
  }
  return { colors, hidden, counts };
}

/** One visible `path:` group per folder, colored round-robin from PALETTE. */
export function defaultFolderGroups(folders: string[]): WebGroup[] {
  return folders.map((f, i) => ({
    query: "path:" + f,
    color: PALETTE[i % PALETTE.length],
    visible: true,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workspace/graph/webGroups.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add landing/src/workspace/graph/webGroups.ts landing/src/workspace/graph/webGroups.test.ts
git commit -m "feat(web): add Knowledge Web grouping logic"
```

---

## Task 3: Model builder / adjacency (TDD)

**Files:**
- Create: `landing/src/workspace/graph/webAdjacency.ts`
- Test: `landing/src/workspace/graph/webAdjacency.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildWebModel, snippetFor, topFolder } from "./webAdjacency";
import type { KnowledgeGraph, VaultFile } from "../../noto-core";

function file(id: string, path: string, content: string): VaultFile {
  const title = path.split("/").pop()!.replace(/\.md$/, "");
  return { id, path, title, content, pinned: false, createdAt: 0, updatedAt: 0 };
}

describe("topFolder", () => {
  it("returns the first path segment", () => {
    expect(topFolder("Biology/Cell.md")).toBe("Biology");
  });
  it("falls back to Notes for a bare filename", () => {
    expect(topFolder("Cell.md")).toBe("Cell.md");
    expect(topFolder("")).toBe("Notes");
  });
});

describe("snippetFor", () => {
  it("strips markdown and collapses whitespace", () => {
    expect(snippetFor("# Title\n\nHello   world")).toContain("Hello world");
  });
  it("truncates long text with an ellipsis", () => {
    const long = "word ".repeat(100);
    const s = snippetFor(long);
    expect(s.length).toBeLessThanOrEqual(220);
    expect(s.endsWith("…")).toBe(true);
  });
});

describe("buildWebModel", () => {
  const files = [
    file("a", "Biology/A.md", "Alpha body"),
    file("b", "Biology/B.md", "Beta body"),
    file("c", "Chemistry/C.md", "Gamma body"),
  ];
  const graph: KnowledgeGraph = {
    nodes: [
      { id: "a", title: "A", path: "Biology/A.md", backlinksCount: 1, outgoingCount: 1, degree: 2 },
      { id: "b", title: "B", path: "Biology/B.md", backlinksCount: 1, outgoingCount: 1, degree: 2 },
      { id: "c", title: "C", path: "Chemistry/C.md", backlinksCount: 0, outgoingCount: 0, degree: 0 },
    ],
    edges: [
      { id: "a->b", source: "a", target: "b", weight: 1 },
      { id: "b->a", source: "b", target: "a", weight: 1 }, // reciprocal — must dedupe
    ],
  };

  it("maps nodes with degree/ins/outs/folder/snippet", () => {
    const m = buildWebModel(graph, files);
    expect(m.nodes[0]).toMatchObject({ id: "a", title: "A", folder: "Biology", deg: 2, ins: 1, outs: 1 });
    expect(m.nodes[0].snippet).toContain("Alpha body");
  });

  it("dedupes reciprocal edges into one undirected link", () => {
    const m = buildWebModel(graph, files);
    expect(m.links).toEqual([[0, 1]]);
  });

  it("builds symmetric neighbor lists without duplicates", () => {
    const m = buildWebModel(graph, files);
    expect(m.nodes[0].nb).toEqual([1]);
    expect(m.nodes[1].nb).toEqual([0]);
    expect(m.nodes[2].nb).toEqual([]);
  });

  it("lists folders in first-seen order and reports maxDeg", () => {
    const m = buildWebModel(graph, files);
    expect(m.folders).toEqual(["Biology", "Chemistry"]);
    expect(m.maxDeg).toBe(2);
  });

  it("ignores self-edges and edges to unknown ids", () => {
    const g2: KnowledgeGraph = {
      nodes: graph.nodes,
      edges: [
        { id: "a->a", source: "a", target: "a", weight: 1 },
        { id: "a->z", source: "a", target: "z", weight: 1 },
      ],
    };
    const m = buildWebModel(g2, files);
    expect(m.links).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace/graph/webAdjacency.test.ts`
Expected: FAIL — cannot resolve `./webAdjacency`.

- [ ] **Step 3: Write the implementation**

```typescript
// Builds the engine's immutable WebModel from the real KnowledgeGraph + files:
// undirected deduped links, symmetric neighbor lists, and plain-text snippets.

import { plainText, type KnowledgeGraph, type VaultFile } from "../../noto-core";
import type { WebModel, WebNode } from "./webTypes";

const SNIPPET_MAX = 220;

/** First path segment, e.g. "Biology/Cell.md" -> "Biology"; "" -> "Notes". */
export function topFolder(path: string): string {
  return path.split("/")[0] || "Notes";
}

/** Plain-text, whitespace-collapsed, ellipsis-truncated preview of note content. */
export function snippetFor(content: string): string {
  const t = plainText(content).replace(/\s+/g, " ").trim();
  return t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX - 1) + "…" : t;
}

export function buildWebModel(graph: KnowledgeGraph, files: VaultFile[]): WebModel {
  const contentById = new Map(files.map((f) => [f.id, f.content]));
  const indexById = new Map<string, number>();

  const nodes: WebNode[] = graph.nodes.map((n, i) => {
    indexById.set(n.id, i);
    return {
      id: n.id,
      title: n.title,
      folder: topFolder(n.path),
      path: n.path,
      deg: n.degree,
      ins: n.backlinksCount,
      outs: n.outgoingCount,
      snippet: snippetFor(contentById.get(n.id) ?? ""),
      nb: [],
    };
  });

  const seen = new Set<string>();
  const links: [number, number][] = [];
  for (const e of graph.edges) {
    const a = indexById.get(e.source);
    const b = indexById.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a < b ? a + "-" + b : b + "-" + a;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push([a, b]);
    nodes[a].nb.push(b);
    nodes[b].nb.push(a);
  }

  const folders: string[] = [];
  const fseen = new Set<string>();
  for (const n of nodes) {
    if (!fseen.has(n.folder)) {
      fseen.add(n.folder);
      folders.push(n.folder);
    }
  }

  const maxDeg = nodes.reduce((m, n) => Math.max(m, n.deg), 1);
  return { nodes, links, folders, maxDeg };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workspace/graph/webAdjacency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/src/workspace/graph/webAdjacency.ts landing/src/workspace/graph/webAdjacency.test.ts
git commit -m "feat(web): add Knowledge Web model builder"
```

---

## Task 4: Persistence (TDD)

**Files:**
- Create: `landing/src/workspace/graph/webPersistence.ts`
- Test: `landing/src/workspace/graph/webPersistence.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { loadWebSettings, saveWebSettings } from "./webPersistence";
import { DEFAULT_SLIDERS, type WebSettings } from "./webTypes";

const KEY = "vault-1";
const PREFIX = "noto:web:v1:";

beforeEach(() => localStorage.clear());

describe("webPersistence", () => {
  it("round-trips settings", () => {
    const settings: WebSettings = {
      sliders: { ...DEFAULT_SLIDERS, repel: 0.8 },
      groups: [{ query: "path:Biology", color: "#578FFA", visible: true }],
    };
    saveWebSettings(KEY, settings);
    expect(loadWebSettings(KEY)).toEqual(settings);
  });

  it("returns null when nothing is stored", () => {
    expect(loadWebSettings(KEY)).toBeNull();
  });

  it("returns null on corrupt JSON", () => {
    localStorage.setItem(PREFIX + KEY, "{not json");
    expect(loadWebSettings(KEY)).toBeNull();
  });

  it("returns null when the groups array is missing", () => {
    localStorage.setItem(PREFIX + KEY, JSON.stringify({ sliders: DEFAULT_SLIDERS }));
    expect(loadWebSettings(KEY)).toBeNull();
  });

  it("preserves an intentionally empty groups array", () => {
    saveWebSettings(KEY, { sliders: DEFAULT_SLIDERS, groups: [] });
    expect(loadWebSettings(KEY)).toEqual({ sliders: DEFAULT_SLIDERS, groups: [] });
  });

  it("clamps out-of-range sliders back to defaults", () => {
    localStorage.setItem(
      PREFIX + KEY,
      JSON.stringify({ sliders: { node: 5, repel: -1 }, groups: [] }),
    );
    const loaded = loadWebSettings(KEY)!;
    expect(loaded.sliders.node).toBe(DEFAULT_SLIDERS.node);
    expect(loaded.sliders.repel).toBe(DEFAULT_SLIDERS.repel);
  });

  it("drops malformed group entries", () => {
    localStorage.setItem(
      PREFIX + KEY,
      JSON.stringify({
        sliders: DEFAULT_SLIDERS,
        groups: [{ query: "path:Bio", color: "#111", visible: true }, { color: "#222" }, null],
      }),
    );
    expect(loadWebSettings(KEY)!.groups).toEqual([
      { query: "path:Bio", color: "#111", visible: true },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace/graph/webPersistence.test.ts`
Expected: FAIL — cannot resolve `./webPersistence`.

- [ ] **Step 3: Write the implementation**

```typescript
// Per-vault persistence of Knowledge Web settings (sliders + groups) in
// localStorage. Tolerant of missing/corrupt data — never throws.

import { DEFAULT_SLIDERS, type WebGroup, type WebSettings, type WebSliders } from "./webTypes";

const PREFIX = "noto:web:v1:";

export function loadWebSettings(vaultKey: string): WebSettings | null {
  try {
    const raw = localStorage.getItem(PREFIX + vaultKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const groups = sanitizeGroups((parsed as Record<string, unknown>)?.groups);
    if (!groups) return null;
    return { sliders: sanitizeSliders((parsed as Record<string, unknown>)?.sliders), groups };
  } catch {
    return null;
  }
}

export function saveWebSettings(vaultKey: string, settings: WebSettings): void {
  try {
    localStorage.setItem(PREFIX + vaultKey, JSON.stringify(settings));
  } catch {
    /* storage full or unavailable — non-fatal */
  }
}

function sanitizeSliders(s: unknown): WebSliders {
  const src = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
  const num = (v: unknown, d: number) =>
    typeof v === "number" && v >= 0 && v <= 1 ? v : d;
  return {
    node: num(src.node, DEFAULT_SLIDERS.node),
    link: num(src.link, DEFAULT_SLIDERS.link),
    text: num(src.text, DEFAULT_SLIDERS.text),
    center: num(src.center, DEFAULT_SLIDERS.center),
    repel: num(src.repel, DEFAULT_SLIDERS.repel),
    spring: num(src.spring, DEFAULT_SLIDERS.spring),
  };
}

/** Returns a cleaned group list, or null if `g` is not an array at all. */
function sanitizeGroups(g: unknown): WebGroup[] | null {
  if (!Array.isArray(g)) return null;
  const out: WebGroup[] = [];
  for (const item of g) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.query !== "string" || typeof rec.color !== "string") continue;
    out.push({ query: rec.query, color: rec.color, visible: rec.visible !== false });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/workspace/graph/webPersistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add landing/src/workspace/graph/webPersistence.ts landing/src/workspace/graph/webPersistence.test.ts
git commit -m "feat(web): add per-vault Knowledge Web persistence"
```

---

## Task 5: Canvas engine

The engine is a direct port of the physics/render/interaction in
`docs/superpowers/specs/assets/knowledge-web-v2.dc.html` (the `Component` class), refactored
into a framework-agnostic class with these deliberate changes:
- data comes from a `WebModel` (real vault) instead of the mock `buildData()`;
- colors come from a `WebColors` struct (theme-aware) instead of hardcoded dark literals;
- selection / preview / open are surfaced through callbacks instead of React `bump()`;
- **double-click** a node fires `onOpen(id)` (new);
- Smart Search highlighting is fed in via `setHighlight(...)` instead of an internal search;
- the internal keyboard shortcut and in-file token search are **removed** (owned by React/NotoWindow).

There is no unit test for this file — canvas physics is verified live in Task 10. Reproduce the code exactly.

**Files:**
- Create: `landing/src/workspace/graph/webEngine.ts`

- [ ] **Step 1: Create the engine file**

```typescript
// Imperative, framework-agnostic force-directed canvas graph. Owns the <canvas>,
// runs the physics + render loop via requestAnimationFrame, and handles pan / zoom /
// drag / hover / pick. React drives it through the public methods and receives
// selection / preview / open events through the callbacks. Ported from
// docs/superpowers/specs/assets/knowledge-web-v2.dc.html.

import type { GroupAssignment } from "./webGroups";
import { DARK_COLORS, type WebColors, type WebModel, type WebNode, type WebSliders } from "./webTypes";

interface ENode extends WebNode {
  x: number; y: number; vx: number; vy: number;
  fixed: boolean; fx: number; fy: number;
  color: string; hidden: boolean;
  x0: number; y0: number;
}

export interface WebCallbacks {
  onSelect: (node: WebNode | null) => void;
  onPreview: (node: WebNode | null) => void;
  onOpen: (fileId: string) => void;
}

export interface WebEngineOptions {
  sliders: WebSliders;
  styling: GroupAssignment;
  colors: WebColors;
  callbacks: WebCallbacks;
  previewDelay?: number; // seconds; default 3
  dimStrength?: number;  // 0..1; default 0.7
}

const TAU = Math.PI * 2;

function makeRand(seed: number): () => number {
  let s = seed;
  return function () {
    s += 0x6d2b79f5;
    let r = Math.imul(s ^ (s >>> 15), 1 | s);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(c: [number, number, number], a: number): string {
  return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a.toFixed(3) + ")";
}

export class WebEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;
  private model: WebModel;
  private nodes: ENode[];
  private links: [number, number][];
  private maxDeg: number;
  private indexById: Map<string, number>;

  private sliders: WebSliders;
  private colors: WebColors;
  private callbacks: WebCallbacks;
  private previewDelay: number;
  private dimStrength: number;

  private cam = { x: 0, y: 0, s: 0.6 };
  private alpha = 1;
  private alphaTarget = 0;
  private hover = -1;
  private hoverStart = 0;
  private dim = 0;
  private sel = -1;
  private drag = -1;
  private pan: { px: number; py: number; cx: number; cy: number } | null = null;
  private moved = 0;
  private down = { px: 0, py: 0 };
  private preview = -1;
  private zooming = false;
  private tween:
    | { t0: number; dur: number; fx: number; fy: number; fs: number; tx: number; ty: number; ts: number; thenPreview: boolean }
    | null = null;
  private active: Set<number> | null = null;
  private ss: Set<number> | null = null;
  private ssDim = 0;
  private ssHot = -1;
  private smartOpen = false;
  private needs = true;

  private rand: () => number;
  private previewEl: HTMLElement | null = null;
  private raf = 0;
  private ac = new AbortController();
  private ro: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement, model: WebModel, opts: WebEngineOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.model = model;
    this.maxDeg = model.maxDeg;
    this.links = model.links;
    this.indexById = new Map(model.nodes.map((n, i) => [n.id, i]));
    this.sliders = { ...opts.sliders };
    this.colors = opts.colors;
    this.callbacks = opts.callbacks;
    this.previewDelay = opts.previewDelay ?? 3;
    this.dimStrength = opts.dimStrength ?? 0.7;
    this.rand = makeRand(1337);

    this.nodes = model.nodes.map((n) => ({
      ...n, x: 0, y: 0, vx: 0, vy: 0, fixed: false, fx: 0, fy: 0,
      color: DARK_COLORS.background, hidden: false, x0: 0, y0: 0,
    }));
    this.applyStyling(opts.styling);
    this.seedPositions();
    const warm = Math.max(40, Math.min(220, Math.floor(60000 / Math.max(1, this.nodes.length))));
    for (let i = 0; i < warm; i++) this.tick();
    this.alpha = 0.02;

    this.sizeCanvas();
    this.attach();
    this.ro = new ResizeObserver(() => { this.sizeCanvas(); this.needs = true; });
    this.ro.observe(canvas);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- public API
  setSliders(s: WebSliders): void { this.sliders = { ...s }; this.needs = true; }
  reheat(): void { this.alpha = Math.max(this.alpha, 0.55); this.needs = true; }
  setColors(c: WebColors): void { this.colors = c; this.needs = true; }
  setPreviewEl(el: HTMLElement | null): void { this.previewEl = el; }
  setSmartOpen(open: boolean): void { this.smartOpen = open; }

  setGroupStyling(styling: GroupAssignment): void {
    this.applyStyling(styling);
    if (this.sel >= 0 && this.nodes[this.sel].hidden) this.select(-1);
    if (this.hover >= 0 && this.nodes[this.hover].hidden) this.setHover(-1);
    this.rebuildActive();
    this.needs = true;
  }

  setHighlight(matchIds: Set<string> | null, hotId: string | null): void {
    if (!matchIds || matchIds.size === 0) {
      this.ss = null;
      this.ssHot = -1;
    } else {
      const set = new Set<number>();
      for (let i = 0; i < this.nodes.length; i++) {
        if (matchIds.has(this.nodes[i].id)) set.add(i);
      }
      this.ss = set;
      this.ssHot = hotId != null ? this.indexById.get(hotId) ?? -1 : -1;
    }
    this.needs = true;
  }

  focusNodeById(id: string): void {
    const i = this.indexById.get(id);
    if (i === undefined) return;
    this.select(i);
    const n = this.nodes[i];
    this.startTween(n.x, n.y, Math.max(1.6, this.cam.s), false);
  }

  selectById(id: string | null): void {
    if (id == null) { this.select(-1); return; }
    const i = this.indexById.get(id);
    if (i !== undefined) this.select(i);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.ac.abort();
    this.ro?.disconnect();
  }

  // --------------------------------------------------------------- internals
  private applyStyling(styling: GroupAssignment): void {
    for (let i = 0; i < this.nodes.length; i++) {
      this.nodes[i].color = styling.colors[i];
      this.nodes[i].hidden = styling.hidden[i];
    }
  }

  private seedPositions(): void {
    const centers = new Map<string, { x: number; y: number }>();
    this.model.folders.forEach((f, i) => {
      const ang = (i / Math.max(1, this.model.folders.length)) * TAU - Math.PI / 2;
      centers.set(f, { x: Math.cos(ang) * 430, y: Math.sin(ang) * 290 });
    });
    for (const n of this.nodes) {
      const c = centers.get(n.folder) ?? { x: 0, y: 0 };
      n.x0 = c.x + (this.rand() - 0.5) * 300;
      n.y0 = c.y + (this.rand() - 0.5) * 260;
      n.x = n.x0; n.y = n.y0;
    }
  }

  private radius(n: ENode): number {
    return (2.3 + 6.8 * Math.sqrt(n.deg / this.maxDeg)) * (0.45 + this.sliders.node * 1.1);
  }

  private tick(): void {
    const N = this.nodes, L = this.links, A = this.alpha, S = this.sliders;
    const rep = 620 * (0.25 + S.repel * 1.7);
    for (let i = 0; i < N.length; i++) {
      const a = N[i];
      for (let j = i + 1; j < N.length; j++) {
        const b = N[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 > 480000) continue;
        if (d2 < 36) { d2 = 36; dx = this.rand() - 0.5; dy = this.rand() - 0.5; }
        const d = Math.sqrt(d2);
        const f = (rep * A) / d2;
        const ux = dx / d, uy = dy / d;
        a.vx -= ux * f; a.vy -= uy * f;
        b.vx += ux * f; b.vy += uy * f;
      }
    }
    const ks = 0.06 * (0.25 + S.spring * 1.7), rest = 62;
    for (let e = 0; e < L.length; e++) {
      const a = N[L[e][0]], b = N[L[e][1]];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = ((d - rest) / d) * ks * A;
      const fx = dx * f, fy = dy * f;
      a.vx += fx * 0.5; a.vy += fy * 0.5;
      b.vx -= fx * 0.5; b.vy -= fy * 0.5;
    }
    const gc = 0.006 * (0.15 + S.center * 1.7) * A;
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      n.vx -= n.x * gc; n.vy -= n.y * gc;
      n.vx *= 0.6; n.vy *= 0.6;
      if (n.fixed) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; }
      else { n.x += n.vx; n.y += n.vy; }
    }
    this.alpha = this.alphaTarget + (this.alpha - this.alphaTarget) * 0.986;
    this.needs = true;
  }

  private draw(): void {
    const c = this.canvas, ctx = this.ctx, dpr = this.dpr;
    const W = c.width / dpr, H = c.height / dpr;
    const cam = this.cam, s = cam.s;
    const ox = W / 2 - cam.x * s, oy = H / 2 - cam.y * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, W, H);
    const N = this.nodes, L = this.links;
    const dim = this.dim * this.dimStrength;
    const ssDim = this.ssDim;
    const ss = this.ss;
    const hA = this.hover, hB = this.sel, hS = this.ssHot;
    const act = this.active;
    const lw = Math.max(0.45, (0.35 + this.sliders.link * 1.7) * Math.sqrt(s));

    // cold edges
    ctx.beginPath();
    for (let e = 0; e < L.length; e++) {
      const i0 = L[e][0], i1 = L[e][1];
      if (i0 === hA || i1 === hA || i0 === hB || i1 === hB) continue;
      const a = N[i0], b = N[i1];
      if (a.hidden || b.hidden) continue;
      ctx.moveTo(a.x * s + ox, a.y * s + oy);
      ctx.lineTo(b.x * s + ox, b.y * s + oy);
    }
    ctx.lineWidth = lw;
    let coldA = 0.17 * (1 - dim * 1.1);
    coldA = coldA * (1 - ssDim * 0.8);
    ctx.strokeStyle = rgba(this.colors.edge, Math.max(0.03, coldA));
    ctx.stroke();

    // edges between two smart-search matches
    if (ss && ssDim > 0.02) {
      ctx.beginPath();
      for (let e = 0; e < L.length; e++) {
        const i0 = L[e][0], i1 = L[e][1];
        if (!ss.has(i0) || !ss.has(i1)) continue;
        const a = N[i0], b = N[i1];
        if (a.hidden || b.hidden) continue;
        ctx.moveTo(a.x * s + ox, a.y * s + oy);
        ctx.lineTo(b.x * s + ox, b.y * s + oy);
      }
      ctx.lineWidth = lw + 0.5 * ssDim;
      ctx.strokeStyle = rgba(this.colors.accent, 0.35 * ssDim);
      ctx.stroke();
    }

    // hot edges (hover / selection)
    if (hA >= 0 || hB >= 0) {
      ctx.beginPath();
      for (let e = 0; e < L.length; e++) {
        const i0 = L[e][0], i1 = L[e][1];
        if (i0 !== hA && i1 !== hA && i0 !== hB && i1 !== hB) continue;
        const a = N[i0], b = N[i1];
        if (a.hidden || b.hidden) continue;
        ctx.moveTo(a.x * s + ox, a.y * s + oy);
        ctx.lineTo(b.x * s + ox, b.y * s + oy);
      }
      ctx.lineWidth = lw + 0.9 * this.dim;
      ctx.strokeStyle = rgba(this.colors.accent, 0.2 + 0.6 * this.dim);
      ctx.stroke();
    }

    // nodes
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (n.hidden) continue;
      const x = n.x * s + ox, y = n.y * s + oy;
      if (x < -40 || x > W + 40 || y < -40 || y > H + 40) continue;
      const r = Math.max(1.1, this.radius(n) * s);
      const inSet = act ? act.has(i) : true;
      let alpha = inSet ? 1 : Math.max(0.12, 1 - dim);
      if (ss) {
        if (ss.has(i)) alpha = Math.max(alpha, 0.55 + 0.45 * ssDim);
        else alpha = Math.min(alpha, Math.max(0.08, 1 - ssDim * 0.9));
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = n.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      if (ss && ss.has(i) && ssDim > 0.02) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, r + 2.5, 0, TAU);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = rgba(this.colors.accent, 0.55 * ssDim);
        ctx.stroke();
      }
      if (i === hS && ssDim > 0.02) {
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, r + 4.5, 0, TAU);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(this.colors.ring, 0.85);
        ctx.stroke();
      }
      if (i === hA || i === hB) {
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(this.colors.ring, 0.9);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, TAU);
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = rgba(this.colors.accent, 0.25 + 0.35 * this.dim);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // labels
    const tThresh = 1.55 - this.sliders.text * 1.5;
    ctx.font = "500 11.5px Inter, sans-serif";
    ctx.textAlign = "center";
    const ssLabels = !!ss && ss.size <= 60;
    for (let i = 0; i < N.length; i++) {
      const n = N[i];
      if (n.hidden) continue;
      const x = n.x * s + ox, y = n.y * s + oy;
      if (x < -90 || x > W + 90 || y < -60 || y > H + 60) continue;
      const eff = s * (0.5 + 1.05 * Math.sqrt(n.deg / this.maxDeg));
      let la = Math.max(0, Math.min(1, (eff - tThresh) / 0.35));
      const inSet = act ? act.has(i) : false;
      if (act && !inSet) la *= Math.max(0, 1 - dim * 1.2);
      if (inSet) la = Math.max(la, this.dim * 0.95);
      if (ss) {
        if (ss.has(i)) { if (ssLabels) la = Math.max(la, ssDim * 0.9); }
        else la *= Math.max(0, 1 - ssDim * 0.85);
      }
      if (i === hA || i === hB || i === hS) la = 1;
      if (la <= 0.03) continue;
      const r = Math.max(1.1, this.radius(n) * s);
      let t = n.title;
      if (t.length > 26) t = t.slice(0, 25) + "…";
      ctx.globalAlpha = la;
      ctx.fillStyle = i === hA || i === hB || i === hS ? this.colors.labelBright : this.colors.labelDim;
      ctx.fillText(t, x, y + r + 13);
    }
    ctx.globalAlpha = 1;
  }

  // --------------------------------------------------------- interaction utils
  private toLocal(e: PointerEvent | WheelEvent | MouseEvent): { px: number; py: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      px: (e.clientX - rect.left) * (this.canvas.clientWidth / Math.max(1, rect.width)),
      py: (e.clientY - rect.top) * (this.canvas.clientHeight / Math.max(1, rect.height)),
    };
  }
  private toWorld(px: number, py: number): { x: number; y: number } {
    const c = this.canvas, cam = this.cam;
    return { x: (px - c.clientWidth / 2) / cam.s + cam.x, y: (py - c.clientHeight / 2) / cam.s + cam.y };
  }
  private pick(wx: number, wy: number): number {
    let best = -1, bd = 1e18;
    const pad = Math.max(3, 7 / this.cam.s);
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.hidden) continue;
      const dx = n.x - wx, dy = n.y - wy;
      const d = dx * dx + dy * dy;
      const r = this.radius(n) + pad;
      if (d < r * r && d < bd) { bd = d; best = i; }
    }
    return best;
  }
  private rebuildActive(): void {
    if (this.hover < 0 && this.sel < 0) { this.active = null; return; }
    const set = new Set<number>();
    [this.hover, this.sel].forEach((i) => {
      if (i < 0) return;
      set.add(i);
      this.nodes[i].nb.forEach((j) => set.add(j));
    });
    this.active = set;
  }
  private setHover(h: number): void {
    if (this.hover === h) return;
    this.hover = h;
    this.hoverStart = performance.now();
    this.zooming = false;
    if (this.preview >= 0) this.setPreviewIndex(-1);
    this.rebuildActive();
    this.needs = true;
  }
  private select(i: number): void {
    this.sel = i;
    this.rebuildActive();
    this.needs = true;
    this.callbacks.onSelect(i >= 0 ? this.nodes[i] : null);
  }
  private setPreviewIndex(i: number): void {
    if (this.preview === i) return;
    this.preview = i;
    this.callbacks.onPreview(i >= 0 ? this.nodes[i] : null);
  }
  private startTween(x: number, y: number, s: number, thenPreview: boolean): void {
    this.tween = { t0: performance.now(), dur: 620, fx: this.cam.x, fy: this.cam.y, fs: this.cam.s, tx: x, ty: y, ts: s, thenPreview };
  }

  private attach(): void {
    const c = this.canvas;
    const signal = this.ac.signal;
    c.addEventListener("pointerdown", (e) => {
      const l = this.toLocal(e);
      const w = this.toWorld(l.px, l.py);
      const hit = this.pick(w.x, w.y);
      this.moved = 0;
      this.down = { px: l.px, py: l.py };
      this.tween = null;
      if (hit >= 0) {
        this.drag = hit;
        const n = this.nodes[hit];
        n.fixed = true; n.fx = w.x; n.fy = w.y;
        this.alphaTarget = 0.3;
        this.alpha = Math.max(this.alpha, 0.3);
        c.style.cursor = "grabbing";
      } else {
        this.pan = { px: l.px, py: l.py, cx: this.cam.x, cy: this.cam.y };
      }
      if (this.preview >= 0) this.setPreviewIndex(-1);
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    }, { signal });

    c.addEventListener("pointermove", (e) => {
      const l = this.toLocal(e);
      this.moved = Math.max(this.moved, Math.abs(l.px - this.down.px) + Math.abs(l.py - this.down.py));
      if (this.drag >= 0) {
        const w = this.toWorld(l.px, l.py);
        const n = this.nodes[this.drag];
        n.fx = w.x; n.fy = w.y;
        this.needs = true;
      } else if (this.pan) {
        this.cam.x = this.pan.cx - (l.px - this.pan.px) / this.cam.s;
        this.cam.y = this.pan.cy - (l.py - this.pan.py) / this.cam.s;
        this.needs = true;
      } else {
        const w = this.toWorld(l.px, l.py);
        const hit = this.pick(w.x, w.y);
        this.setHover(hit);
        c.style.cursor = hit >= 0 ? "grab" : "default";
      }
    }, { signal });

    c.addEventListener("pointerup", () => {
      if (this.drag >= 0) {
        const i = this.drag;
        this.nodes[i].fixed = false;
        this.alphaTarget = 0;
        this.drag = -1;
        c.style.cursor = "grab";
        if (this.moved < 5) this.select(i);
      } else if (this.pan) {
        this.pan = null;
        if (this.moved < 5 && this.sel >= 0) this.select(-1);
      }
    }, { signal });

    c.addEventListener("pointerleave", () => {
      if (this.drag < 0 && !this.pan) this.setHover(-1);
    }, { signal });

    c.addEventListener("dblclick", (e) => {
      const l = this.toLocal(e);
      const w = this.toWorld(l.px, l.py);
      const hit = this.pick(w.x, w.y);
      if (hit >= 0) this.callbacks.onOpen(this.nodes[hit].id);
    }, { signal });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const l = this.toLocal(e);
      const w = this.toWorld(l.px, l.py);
      const ns = Math.min(6, Math.max(0.12, this.cam.s * Math.exp(-e.deltaY * 0.0014)));
      this.cam.x = w.x - (l.px - c.clientWidth / 2) / ns;
      this.cam.y = w.y - (l.py - c.clientHeight / 2) / ns;
      this.cam.s = ns;
      this.tween = null;
      this.needs = true;
    }, { signal, passive: false });
  }

  private sizeCanvas(): void {
    const c = this.canvas;
    c.width = Math.max(2, c.clientWidth * this.dpr);
    c.height = Math.max(2, c.clientHeight * this.dpr);
  }

  private placePreview(): void {
    const el = this.previewEl;
    if (!el || this.preview < 0) return;
    const n = this.nodes[this.preview];
    const c = this.canvas, cam = this.cam;
    const W = c.clientWidth, H = c.clientHeight;
    const x = (n.x - cam.x) * cam.s + W / 2;
    const y = (n.y - cam.y) * cam.s + H / 2;
    const r = this.radius(n) * cam.s;
    let px = x + r + 18;
    if (px + 310 > W - 10) px = x - r - 318;
    const py = Math.max(10, Math.min(H - 210, y - 46));
    el.style.transform = "translate(" + px.toFixed(1) + "px," + py.toFixed(1) + "px)";
  }

  private loop = (now: number): void => {
    if (this.alpha > 0.012 || this.drag >= 0 || this.alphaTarget > 0) this.tick();

    const target = this.hover >= 0 || this.sel >= 0 ? 1 : 0;
    const nd = this.dim + (target - this.dim) * 0.16;
    if (Math.abs(nd - target) > 0.004) { this.dim = nd; this.needs = true; }
    else if (this.dim !== target) { this.dim = target; this.needs = true; }

    const ssTarget = this.ss && this.ss.size > 0 ? 1 : 0;
    const nsd = this.ssDim + (ssTarget - this.ssDim) * 0.14;
    if (Math.abs(nsd - ssTarget) > 0.004) { this.ssDim = nsd; this.needs = true; }
    else if (this.ssDim !== ssTarget) { this.ssDim = ssTarget; this.needs = true; }

    if (this.tween) {
      const tw = this.tween;
      let t = (now - tw.t0) / tw.dur;
      if (t >= 1) t = 1;
      const e = 1 - Math.pow(1 - t, 3);
      this.cam.x = tw.fx + (tw.tx - tw.fx) * e;
      this.cam.y = tw.fy + (tw.ty - tw.fy) * e;
      this.cam.s = tw.fs + (tw.ts - tw.fs) * e;
      this.needs = true;
      if (t >= 1) {
        this.tween = null;
        if (tw.thenPreview && this.hover >= 0 && this.preview < 0) this.setPreviewIndex(this.hover);
      }
    }

    if (this.hover >= 0 && this.preview < 0 && this.drag < 0 && !this.pan && !this.tween && !this.smartOpen) {
      const delay = this.previewDelay * 1000;
      if (now - this.hoverStart > delay) {
        if (this.cam.s >= 1.05) this.setPreviewIndex(this.hover);
        else if (!this.zooming) {
          this.zooming = true;
          const n = this.nodes[this.hover];
          this.startTween(n.x, n.y, 1.45, true);
        }
      }
    }

    if (this.needs) { this.draw(); this.needs = false; }
    if (this.preview >= 0) this.placePreview();
    this.raf = requestAnimationFrame(this.loop);
  };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors from `webEngine.ts`.

- [ ] **Step 3: Commit**

```bash
git add landing/src/workspace/graph/webEngine.ts
git commit -m "feat(web): add Knowledge Web canvas engine"
```

---

## Task 6: React shell (`KnowledgeWeb.tsx`) + styles

**Files:**
- Create: `landing/src/workspace/graph/KnowledgeWeb.tsx`
- Modify: `landing/src/styles/workspace.css` (append new rules; old `.nw-web*` removed in Task 9)

- [ ] **Step 1: Create the component**

```tsx
// The Knowledge Web view: a canvas force-directed graph (driven by WebEngine)
// plus the floating control panel, node info card, hover-preview card, and stats.
// Engine runs the hot path outside React; this component renders chrome and drives
// the engine imperatively via a ref.

import { useEffect, useMemo, useRef, useState } from "react";
import { assignGroups, defaultFolderGroups } from "./webGroups";
import { loadWebSettings, saveWebSettings } from "./webPersistence";
import { WebEngine } from "./webEngine";
import {
  DARK_COLORS, DEFAULT_SLIDERS, PALETTE,
  type WebColors, type WebGroup, type WebModel, type WebSliders,
} from "./webTypes";

interface Props {
  model: WebModel;
  onOpenNote: (fileId: string) => void;
  /** localStorage namespace; undefined in the demo (settings not persisted). */
  persistKey?: string;
  theme?: "light" | "dark";
  /** Whether Smart Search is open (suppresses hover previews). */
  smartOpen: boolean;
  /** File ids that currently match Smart Search, or null when it's closed. */
  smartMatchIds: Set<string> | null;
  /** The file id of the actively-highlighted Smart Search result, if any. */
  smartHotId: string | null;
}

type SectionKey = "filters" | "groups" | "dsp" | "forces";

export function KnowledgeWeb({ model, onOpenNote, persistKey, theme, smartOpen, smartMatchIds, smartHotId }: Props) {
  const initial = useMemo(() => {
    const saved = persistKey ? loadWebSettings(persistKey) : null;
    return {
      sliders: saved?.sliders ?? DEFAULT_SLIDERS,
      groups: saved?.groups ?? defaultFolderGroups(model.folders),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once per mount/model
  }, [persistKey, model]);

  const [sliders, setSliders] = useState<WebSliders>(initial.sliders);
  const [groups, setGroups] = useState<WebGroup[]>(initial.groups);
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({ filters: true, groups: true, dsp: false, forces: false });
  const [filter, setFilter] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewElRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WebEngine | null>(null);
  const reheatRef = useRef(false);

  const nodeIndexById = useMemo(() => new Map(model.nodes.map((n, i) => [n.id, i])), [model]);
  const styling = useMemo(() => assignGroups(model.nodes, groups), [model, groups]);

  // Latest values engine callbacks / re-creation read without re-subscribing.
  const latest = useRef({ styling, sliders, onOpenNote, smartMatchIds, smartHotId, smartOpen });
  latest.current = { styling, sliders, onOpenNote, smartMatchIds, smartHotId, smartOpen };

  // Create the engine once per model. Camera/positions reset on real data change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root) return;
    setSelId(null); // a fresh engine starts with nothing selected/previewed
    setPreviewId(null);
    const engine = new WebEngine(canvas, model, {
      sliders: latest.current.sliders,
      styling: latest.current.styling,
      colors: readWebColors(root),
      callbacks: {
        onSelect: (n) => setSelId(n ? n.id : null),
        onPreview: (n) => setPreviewId(n ? n.id : null),
        onOpen: (id) => latest.current.onOpenNote(id),
      },
    });
    engine.setPreviewEl(previewElRef.current);
    engine.setSmartOpen(latest.current.smartOpen);
    engine.setHighlight(latest.current.smartMatchIds, latest.current.smartHotId);
    engineRef.current = engine;
    return () => { engine.destroy(); engineRef.current = null; };
  }, [model]);

  // Push slider changes; reheat the sim after a force slider moved.
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setSliders(sliders);
    if (reheatRef.current) { eng.reheat(); reheatRef.current = false; }
  }, [sliders]);

  // Push group color/visibility changes.
  useEffect(() => { engineRef.current?.setGroupStyling(styling); }, [styling]);

  // Bridge Smart Search highlight + open state.
  useEffect(() => { engineRef.current?.setHighlight(smartMatchIds, smartHotId); }, [smartMatchIds, smartHotId]);
  useEffect(() => { engineRef.current?.setSmartOpen(smartOpen); }, [smartOpen]);

  // Re-read theme colors on toggle.
  useEffect(() => {
    const root = rootRef.current;
    if (root) engineRef.current?.setColors(readWebColors(root));
  }, [theme]);

  // Debounced per-vault persistence.
  useEffect(() => {
    if (!persistKey) return;
    const t = setTimeout(() => saveWebSettings(persistKey, { sliders, groups }), 400);
    return () => clearTimeout(t);
  }, [persistKey, sliders, groups]);

  const setDisplay = (key: keyof WebSliders, val: number) => { reheatRef.current = false; setSliders((s) => ({ ...s, [key]: val })); };
  const setForce = (key: keyof WebSliders, val: number) => { reheatRef.current = true; setSliders((s) => ({ ...s, [key]: val })); };

  const focus = (id: string) => engineRef.current?.focusNodeById(id);
  const colorOf = (id: string) => styling.colors[nodeIndexById.get(id) ?? 0] ?? PALETTE[0];

  const filterResults = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return [] as { id: string; title: string; color: string }[];
    const out: { id: string; title: string; color: string }[] = [];
    for (let i = 0; i < model.nodes.length && out.length < 10; i++) {
      if (styling.hidden[i]) continue;
      const n = model.nodes[i];
      if (n.title.toLowerCase().includes(q)) out.push({ id: n.id, title: n.title, color: styling.colors[i] });
    }
    return out;
  }, [filter, model, styling]);

  const selIdx = selId != null ? nodeIndexById.get(selId) : undefined;
  const selNode = selIdx != null ? model.nodes[selIdx] : null;
  const neighbors = selNode ? selNode.nb.slice(0, 14).map((j) => model.nodes[j]) : [];
  const previewIdx = previewId != null ? nodeIndexById.get(previewId) : undefined;
  const previewNode = previewIdx != null ? model.nodes[previewIdx] : null;

  const chev = (o: boolean) => ({ transform: o ? "rotate(90deg)" : "none", transition: "transform 160ms", display: "flex", color: "var(--nw-dim)" });

  return (
    <div ref={rootRef} className="nw-web2">
      <canvas ref={canvasRef} className="nw-web2-canvas" />

      {/* control panel */}
      <div className="nw-web2-panel">
        <button className="nw-web2-sec" onClick={() => setOpen((o) => ({ ...o, filters: !o.filters }))}>
          <span style={chev(open.filters)}><Chevron /></span><span style={{ flex: 1 }}>Filters</span>
        </button>
        {open.filters && (
          <div className="nw-web2-sec-body">
            <div className="nw-web2-field">
              <Search />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search nodes…" />
            </div>
            {filterResults.length > 0 && (
              <div className="nw-web2-results">
                {filterResults.map((r) => (
                  <button key={r.id} className="nw-web2-result" onClick={() => { setFilter(""); focus(r.id); }}>
                    <span className="nw-web2-dot" style={{ background: r.color }} />
                    <span className="nw-web2-ellip">{r.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="nw-web2-div" />
        <button className="nw-web2-sec" onClick={() => setOpen((o) => ({ ...o, groups: !o.groups }))}>
          <span style={chev(open.groups)}><Chevron /></span><span style={{ flex: 1 }}>Groups</span>
        </button>
        {open.groups && (
          <div className="nw-web2-sec-body nw-web2-groups">
            {groups.map((g, i) => (
              <div key={i} className="nw-web2-group">
                <input type="checkbox" checked={g.visible} onChange={() => setGroups((gs) => gs.map((x, k) => (k === i ? { ...x, visible: !x.visible } : x)))} />
                <button className="nw-web2-swatch" title="Change color"
                  onClick={() => setGroups((gs) => gs.map((x, k) => (k === i ? { ...x, color: PALETTE[(PALETTE.indexOf(x.color) + 1) % PALETTE.length] } : x)))}>
                  <span className="nw-web2-dot" style={{ background: g.color, width: "100%", height: "100%" }} />
                </button>
                <input className="nw-web2-gq" value={g.query}
                  onChange={(e) => setGroups((gs) => gs.map((x, k) => (k === i ? { ...x, query: e.target.value } : x)))} />
                <span className="nw-web2-gc">{styling.counts[i]}</span>
                <button className="nw-web2-x" onClick={() => setGroups((gs) => gs.filter((_, k) => k !== i))}><Close /></button>
              </div>
            ))}
            <button className="nw-web2-addgroup"
              onClick={() => setGroups((gs) => [...gs, { query: "path:", color: PALETTE[gs.length % PALETTE.length], visible: true }])}>
              <Plus /> New group
            </button>
          </div>
        )}

        <div className="nw-web2-div" />
        <button className="nw-web2-sec" onClick={() => setOpen((o) => ({ ...o, dsp: !o.dsp }))}>
          <span style={chev(open.dsp)}><Chevron /></span><span style={{ flex: 1 }}>Display</span>
        </button>
        {open.dsp && (
          <div className="nw-web2-sec-body nw-web2-sliders">
            <Slider label="Node size" value={sliders.node} onChange={(v) => setDisplay("node", v)} />
            <Slider label="Link thickness" value={sliders.link} onChange={(v) => setDisplay("link", v)} />
            <Slider label="Text fade threshold" value={sliders.text} onChange={(v) => setDisplay("text", v)} />
          </div>
        )}

        <div className="nw-web2-div" />
        <button className="nw-web2-sec" onClick={() => setOpen((o) => ({ ...o, forces: !o.forces }))}>
          <span style={chev(open.forces)}><Chevron /></span><span style={{ flex: 1 }}>Forces</span>
        </button>
        {open.forces && (
          <div className="nw-web2-sec-body nw-web2-sliders">
            <Slider label="Center force" value={sliders.center} onChange={(v) => setForce("center", v)} />
            <Slider label="Repel force" value={sliders.repel} onChange={(v) => setForce("repel", v)} />
            <Slider label="Link force" value={sliders.spring} onChange={(v) => setForce("spring", v)} />
          </div>
        )}
      </div>

      {/* node info card */}
      {selNode && (
        <div className="nw-web2-info">
          <div className="nw-web2-info-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="nw-web2-info-title">{selNode.title}</div>
              <div className="nw-web2-info-path">{selNode.path}</div>
            </div>
            <button className="nw-web2-x" onClick={() => engineRef.current?.selectById(null)}><Close /></button>
          </div>
          <div className="nw-web2-info-meta">
            <span>{selNode.outs} links</span><span>{selNode.ins} backlinks</span>
            <span style={{ color: "var(--nw-muted)" }}>degree {selNode.deg}</span>
          </div>
          <button className="nw-web2-open" onClick={() => onOpenNote(selNode.id)}>Open note</button>
          <div className="nw-web2-info-lbl">Neighbors ({selNode.nb.length})</div>
          <div className="nw-web2-neighbors">
            {neighbors.map((n) => (
              <button key={n.id} className="nw-web2-result" onClick={() => focus(n.id)}>
                <span className="nw-web2-dot" style={{ background: colorOf(n.id) }} />
                <span className="nw-web2-ellip">{n.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* hover preview (positioned imperatively by the engine) */}
      <div ref={previewElRef} className="nw-web2-preview" style={{ opacity: previewNode ? 1 : 0 }}>
        {previewNode && (
          <>
            <div className="nw-web2-info-title">{previewNode.title}</div>
            <div className="nw-web2-info-path">{previewNode.path}</div>
            <div className="nw-web2-info-meta"><span>{previewNode.outs} links</span><span>{previewNode.ins} backlinks</span></div>
            <div className="nw-web2-pv-snippet">{previewNode.snippet}</div>
          </>
        )}
      </div>

      <div className="nw-web2-stats">
        {model.nodes.length} notes · {model.links.length} connections · {groups.length} groups
      </div>
    </div>
  );
}

/* ------------------------------- subcomponents ------------------------------ */

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="nw-web2-slider">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

/* ---------------------------------- icons ---------------------------------- */
const Chevron = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>);
const Search = () => (<span style={{ display: "flex", color: "var(--nw-dim)" }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg></span>);
const Plus = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>);
const Close = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>);

/* ------------------------------ theme colors ------------------------------- */

function parseRGB(input: string, fallback: [number, number, number]): [number, number, number] {
  const m = input.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(",").map((x) => parseFloat(x));
    if (p.length >= 3 && p.slice(0, 3).every((n) => !isNaN(n))) return [p[0], p[1], p[2]];
  }
  return fallback;
}

/** Resolve a CSS custom property to a concrete rgb() string via a hidden probe. */
function resolveColor(root: HTMLElement, cssVar: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.cssText = `color:var(${cssVar});position:absolute;display:none`;
  root.appendChild(probe);
  const c = getComputedStyle(probe).color;
  root.removeChild(probe);
  return c || fallback;
}

function readWebColors(root: HTMLElement): WebColors {
  const bg = resolveColor(root, "--nw-window", DARK_COLORS.background);
  const dim = resolveColor(root, "--nw-muted", DARK_COLORS.labelDim);
  const bright = resolveColor(root, "--nw-ink", DARK_COLORS.labelBright);
  const accent = resolveColor(root, "--nw-accent", "rgb(87,143,250)");
  return {
    background: bg,
    edge: parseRGB(dim, DARK_COLORS.edge),
    labelDim: dim,
    labelBright: bright,
    accent: parseRGB(accent, DARK_COLORS.accent),
    ring: parseRGB(bright, DARK_COLORS.ring),
  };
}
```

- [ ] **Step 2: Append the styles**

Add to the end of `landing/src/styles/workspace.css`:

```css
/* ============================ Knowledge Web v2 ============================ */
.nw-web2 { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: var(--nw-window); }
.nw-web2-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }

.nw-web2-panel {
  position: absolute; top: 14px; left: 14px; width: 256px; z-index: 10;
  background: rgba(20, 22, 25, 0.94); border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px; box-shadow: 0 22px 40px rgba(0, 0, 0, 0.45);
  max-height: calc(100% - 28px); overflow-y: auto;
}
html[data-theme="light"] .nw-web2-panel { background: rgba(255, 255, 255, 0.95); border-color: var(--nw-line-3); }
.nw-web2-sec {
  width: 100%; display: flex; align-items: center; gap: 7px; padding: 11px 12px;
  background: transparent; border: none; cursor: pointer; color: var(--nw-soft-2);
  font: 600 12.5px var(--nw-font); text-align: left;
}
.nw-web2-sec-body { padding: 0 12px 12px; }
.nw-web2-div { height: 1px; background: var(--nw-line); }
.nw-web2-field {
  display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px;
  border-radius: 8px; background: var(--nw-field); border: 1px solid var(--nw-line-2);
}
.nw-web2-field input { flex: 1; border: none; background: transparent; color: var(--nw-ink); font: 12.5px var(--nw-font); min-width: 0; outline: none; }
.nw-web2-results { margin-top: 6px; max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.nw-web2-result { display: flex; align-items: center; gap: 8px; padding: 5px 7px; border-radius: 7px; border: none; background: transparent; cursor: pointer; color: var(--nw-soft-2); font: 12px var(--nw-font); text-align: left; width: 100%; }
.nw-web2-result:hover { background: var(--nw-accent-soft); }
.nw-web2-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; display: block; }
.nw-web2-ellip { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.nw-web2-groups { display: flex; flex-direction: column; gap: 7px; }
.nw-web2-group { display: flex; align-items: center; gap: 6px; }
.nw-web2-group input[type="checkbox"] { accent-color: var(--nw-accent); width: 13px; height: 13px; flex: none; cursor: pointer; margin: 0; }
.nw-web2-swatch { width: 17px; height: 17px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.18); padding: 3px; background: transparent; cursor: pointer; flex: none; display: flex; }
.nw-web2-gq { flex: 1; min-width: 0; height: 25px; padding: 0 7px; border-radius: 7px; background: var(--nw-field); border: 1px solid var(--nw-line-2); color: var(--nw-soft); font: 11px var(--nw-mono); outline: none; }
.nw-web2-gc { font-size: 10.5px; color: var(--nw-dim); min-width: 16px; text-align: right; }
.nw-web2-x { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 5px; border: none; background: transparent; cursor: pointer; color: var(--nw-dim); flex: none; padding: 0; }
.nw-web2-addgroup { align-self: flex-start; display: flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--nw-line-3); background: transparent; cursor: pointer; color: var(--nw-muted); font: 500 11.5px var(--nw-font); }

.nw-web2-sliders { display: flex; flex-direction: column; gap: 9px; }
.nw-web2-slider { display: flex; flex-direction: column; gap: 3px; }
.nw-web2-slider span { font-size: 11.5px; color: var(--nw-muted); }
.nw-web2-slider input[type="range"] { width: 100%; accent-color: var(--nw-accent); height: 14px; margin: 0; }

.nw-web2-info {
  position: absolute; right: 14px; bottom: 14px; width: 290px; z-index: 15;
  background: var(--nw-card); border: 1px solid var(--nw-line-3); border-radius: 12px;
  box-shadow: 0 22px 40px rgba(0, 0, 0, 0.45); padding: 13px 14px;
  animation: nw-web2-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.nw-web2-info-head { display: flex; align-items: flex-start; gap: 8px; }
.nw-web2-info-title { font-size: 14.5px; font-weight: 600; color: var(--nw-ink); line-height: 1.3; }
.nw-web2-info-path { font-size: 11px; color: var(--nw-dim); margin-top: 3px; font-family: var(--nw-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nw-web2-info-meta { display: flex; gap: 12px; margin-top: 9px; font-size: 11.5px; color: var(--nw-accent-ink); }
.nw-web2-open { margin-top: 11px; width: 100%; height: 30px; border-radius: 8px; border: 1px solid var(--nw-accent-border); background: var(--nw-accent-soft); color: var(--nw-accent-ink); font: 600 12.5px var(--nw-font); cursor: pointer; }
.nw-web2-info-lbl { font-size: 11px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: var(--nw-dim); margin: 11px 0 5px; }
.nw-web2-neighbors { max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }

.nw-web2-preview {
  position: absolute; left: 0; top: 0; width: 300px; pointer-events: none; z-index: 20;
  background: var(--nw-card); border: 1px solid var(--nw-line-3); border-radius: 12px;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.4); padding: 13px 14px;
  transform: translate(-2000px, -2000px); transition: opacity 180ms;
}
.nw-web2-pv-snippet { margin-top: 9px; font-size: 12.5px; line-height: 1.5; color: var(--nw-muted); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }

.nw-web2-stats { position: absolute; left: 16px; bottom: 12px; font-size: 11px; color: var(--nw-dim); z-index: 5; pointer-events: none; }

@keyframes nw-web2-in { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors. (`KnowledgeWeb` is not yet imported anywhere — that's fine.)

- [ ] **Step 4: Commit**

```bash
git add landing/src/workspace/graph/KnowledgeWeb.tsx landing/src/styles/workspace.css
git commit -m "feat(web): add Knowledge Web v2 React shell + styles"
```

---

## Task 7: Add `onHoverResult` to SmartSearchPanel

**Files:**
- Modify: `landing/src/workspace/smartSearch/SmartSearchPanel.tsx`

- [ ] **Step 1: Add the prop to the interface**

In the `Props` interface (around line 13), add the optional callback after `onOpenResult`:

```tsx
interface Props {
  smart: SmartSearchState;
  /** The title-bar search box to anchor/morph from. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onOpenResult: (result: SmartResult) => void;
  /** Reports the currently-highlighted result's file id (for graph spotlight). */
  onHoverResult?: (fileId: string | null) => void;
}
```

- [ ] **Step 2: Destructure it**

Change the component signature (line 33):

```tsx
export function SmartSearchPanel({ smart, anchorRef, onClose, onOpenResult, onHoverResult }: Props) {
```

- [ ] **Step 3: Report the active row and clear on unmount**

Immediately after the existing `useEffect(() => { inputRef.current?.focus(); }, []);` block (around line 94), add:

```tsx
  // Mirror the active result into the graph spotlight; clear when unmounting.
  useEffect(() => {
    onHoverResult?.(results[active]?.fileId ?? null);
  }, [active, results, onHoverResult]);
  useEffect(() => () => onHoverResult?.(null), [onHoverResult]);
```

- [ ] **Step 4: Verify it typechecks**

Run: `npx tsc --noEmit`
Expected: no new errors. (`onHoverResult` is optional, so existing call sites still compile.)

- [ ] **Step 5: Commit**

```bash
git add landing/src/workspace/smartSearch/SmartSearchPanel.tsx
git commit -m "feat(web): report Smart Search hovered result for graph spotlight"
```

---

## Task 8: Remove retired `graphFilter` plumbing from useWorkspace

The new graph has no All/Linked/Orphans filter, so the persisted `graphFilter` slice is dead. Remove it (old persisted snapshots simply ignore the missing field).

**Files:**
- Modify: `landing/src/workspace/useWorkspace.ts`

- [ ] **Step 1: Remove the import**

Delete line 9:

```tsx
import type { WebFilter } from "./GraphView";
```

- [ ] **Step 2: Remove the field from the persisted type**

Find the `PersistedWorkspace` interface near the top of the file and delete its `graphFilter` line:

```tsx
  graphFilter: WebFilter;
```

- [ ] **Step 3: Remove the two initializers**

Delete the `graphFilter: "all",` line in the `fallback()` object (line ~102) and the `graphFilter: parsed.graphFilter ?? "all",` line in the restore path (line ~129).

- [ ] **Step 4: Remove the state, snapshot, and returns**

- Delete the state hook (line ~144): `const [graphFilter, setGraphFilter] = useState<WebFilter>(initial.graphFilter);`
- In the persist `snapshot` object (line ~155), remove `graphFilter,` from the list.
- In that effect's dependency array (line ~162), remove `graphFilter`.
- In the returned object (lines ~390 and ~392), remove `graphFilter,` and `setGraphFilter,`.

- [ ] **Step 5: Verify no references remain**

Run: `grep -n "graphFilter\|WebFilter" src/workspace/useWorkspace.ts`
Expected: no output.

- [ ] **Step 6: Verify it typechecks (expect one error, fixed in Task 9)**

Run: `npx tsc --noEmit`
Expected: the only new error is in `NotoWindow.tsx` (still passes `filter`/`setFilter` to the old `GraphView` and reads `ws.graphFilter`). That is resolved in Task 9. If any error points at `useWorkspace.ts` itself, fix the leftover reference before continuing.

- [ ] **Step 7: Commit**

```bash
git add landing/src/workspace/useWorkspace.ts
git commit -m "refactor(web): drop retired graphFilter workspace state"
```

---

## Task 9: Wire KnowledgeWeb into NotoWindow + delete GraphView

**Files:**
- Modify: `landing/src/workspace/NotoWindow.tsx`
- Modify: `landing/src/styles/workspace.css` (remove old `.nw-web*` rules)
- Delete: `landing/src/workspace/GraphView.tsx`

- [ ] **Step 1: Swap imports**

In `NotoWindow.tsx`, remove `filterGraph` from the `noto-core` import (line ~10-16) and delete the `GraphView` import (line 27). Add the new imports:

```tsx
import { KnowledgeWeb } from "./graph/KnowledgeWeb";
import { buildWebModel } from "./graph/webAdjacency";
```

The `noto-core` import block should now read:

```tsx
import {
  buildGraph,
  buildMetadataCache,
  createLectureNote,
  type VaultFile,
} from "../noto-core";
```

- [ ] **Step 2: Build the model; drop the old filtered graph**

Replace the `visibleGraph` memo (lines ~167-170):

```tsx
  const visibleGraph = useMemo(
    () => filterGraph(fullGraph, ws.graphFilter, ws.currentNoteId),
    [fullGraph, ws.graphFilter, ws.currentNoteId],
  );
```

with:

```tsx
  const webModel = useMemo(() => buildWebModel(fullGraph, files), [fullGraph, files]);
```

- [ ] **Step 3: Add Smart Search highlight state**

Just after the `smart` setup (after line ~81, `const smart = useSmartSearch(...)`), add:

```tsx
  const [smartHotId, setSmartHotId] = useState<string | null>(null);
  const smartMatchIds = useMemo(
    () => (smartOpen ? new Set(smart.results.map((r) => r.fileId)) : null),
    [smartOpen, smart.results],
  );
```

In `closeSmart` (the `useCallback` at line ~87), add `setSmartHotId(null);`:

```tsx
  const closeSmart = useCallback(() => {
    setSmartOpen(false);
    setSmartHotId(null);
    smartResetRef.current();
  }, []);
```

- [ ] **Step 4: Render KnowledgeWeb for the graph tab**

Replace the `if (tab.kind === "graph")` block in `renderBody` (lines ~247-257):

```tsx
    if (tab.kind === "graph") {
      return (
        <GraphView
          graph={visibleGraph}
          focusId={ws.currentNoteId}
          filter={ws.graphFilter}
          setFilter={ws.setGraphFilter}
          onSelect={ws.openNote}
        />
      );
    }
```

with:

```tsx
    if (tab.kind === "graph") {
      return (
        <KnowledgeWeb
          model={webModel}
          onOpenNote={ws.openNote}
          persistKey={persistKey}
          theme={controller.theme}
          smartOpen={smartOpen}
          smartMatchIds={smartMatchIds}
          smartHotId={smartHotId}
        />
      );
    }
```

- [ ] **Step 5: Pass the hover callback to SmartSearchPanel**

In the `SmartSearchPanel` render near the bottom (line ~357-364), add the `onHoverResult` prop:

```tsx
      {smartOpen && (
        <SmartSearchPanel
          smart={smart}
          anchorRef={searchBoxRef}
          onClose={closeSmart}
          onOpenResult={openSmartResult}
          onHoverResult={setSmartHotId}
        />
      )}
```

- [ ] **Step 6: Remove the old graph CSS**

In `landing/src/styles/workspace.css`, delete the old Knowledge Web rules — every rule whose selector starts with `.nw-web` and is NOT `.nw-web2` (the block near line 522: `.nw-web`, `.nw-web-head`, `.nw-web-title`, `.nw-web-sub`, `.nw-web-chips`, `.nw-web-chip`, `.nw-web-chip.is-active`, `.nw-web-canvas-wrap`, `.nw-web-canvas`, and the `html[data-theme="light"] .nw-web-canvas` rule). Leave all `.nw-web2*` rules intact.

- [ ] **Step 7: Delete GraphView**

```bash
git rm landing/src/workspace/GraphView.tsx
```

- [ ] **Step 8: Verify typecheck + lint + full test suite**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm test`
Expected: all tests pass (including the three new graph test files).

- [ ] **Step 9: Commit**

```bash
git add landing/src/workspace/NotoWindow.tsx landing/src/styles/workspace.css
git commit -m "feat(web): replace static graph with Knowledge Web v2"
```

---

## Task 10: Live verification

Verify the running app with the preview tools (not screenshots-as-proof-of-logic). If a launch config is missing, create `.claude/launch.json` for the Vite dev server (`landing/`, `npm run dev`) first.

- [ ] **Step 1: Start the dev server and open the workspace**

Use `preview_start`, then navigate to the demo workspace. Open the **Knowledge Web** from the sidebar.

- [ ] **Step 2: Check the console + canvas render**

- `preview_console_logs` (level error): expected empty.
- `preview_snapshot` / `preview_screenshot`: the graph fills the pane; the floating panel sits top-left with Filters + Groups open; the stats footer reads `N notes · M connections · G groups` with real numbers.

- [ ] **Step 3: Interactions**

- Scroll to zoom, drag the background to pan, drag a node (it follows, then re-settles).
- Single-click a node → the info card appears bottom-right with links/backlinks/degree + neighbors.
- Click a neighbor → camera tweens to it.
- Click **Open note** and separately double-click a node → both open the note in a tab.
- Hover a node ~3s → the preview card appears next to it with the real snippet.

- [ ] **Step 4: Panel controls**

- Filters: type in "Search nodes…" → matching rows appear; click one → focuses that node.
- Groups: toggle a group's checkbox (its nodes disappear/return); click a swatch (color cycles); edit a query to `path:Biology` (count updates); add + remove a group.
- Display/Forces: drag each slider and confirm node size / link thickness / label fade / layout respond.

- [ ] **Step 5: Smart Search bridge**

- Press ⌘⇧F. Type a query. Behind the panel, matching nodes brighten with accent rings; unmatched fade.
- Arrow-key/hover the results → the corresponding node gets a white spotlight ring.
- Press ↵ → the note opens (panel closes).

- [ ] **Step 6: Persistence + theme**

- Change a slider and a group color, switch to a note tab and back to the graph → settings persist (auth app / with `persistKey`).
- Toggle light/dark (sidebar account menu) → the canvas background, labels, and edges follow the theme; group colors stay vivid.

- [ ] **Step 7: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "fix(web): Knowledge Web v2 live-verification tweaks"
```

(Skip if no changes were needed.)

---

## Notes for the implementer

- **`npx` vs scripts:** tests run via `npm test` (`vitest run`); for a single file use `npx vitest run <path>`. Typecheck with `npx tsc --noEmit`, lint with `npm run lint`. All from `landing/`.
- **Engine has no unit test on purpose** — it's canvas/RAF/pointer code. All branchable logic lives in the tested pure modules. Do not add jsdom canvas tests.
- **Don't touch** `landing/src/noto-core/graph.ts` — `filterGraph` and its `graph.test.ts` stay green as a Swift-parity artifact even though the web UI no longer calls it.
- **Engine re-creation** happens only when `model` identity changes (notes added/removed), which resets camera/positions by design; slider/group/highlight/theme changes never rebuild it.
```
