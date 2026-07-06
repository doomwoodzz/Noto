# Knowledge Web v2 — Design Spec

**Date:** 2026-07-06
**Branch:** `feat/noto-web-app`
**Status:** Approved (design), pending implementation plan
**Source of truth:** Claude Design handoff `Knowledge Web v2.dc.html`

## Summary

Replace the static SVG Knowledge Web (`landing/src/workspace/GraphView.tsx`) with a
canvas-based, force-directed interactive graph that matches the v2 design handoff. The
new view adds pan / zoom / drag physics, an Obsidian-style floating control panel
(Filters, Groups, Display, Forces), a node info card, hover-preview cards, and a bridge
to the app's real semantic Smart Search so matching notes light up in the graph.

The redesign touches **only the graph pane body**. The window chrome shown in the
handoff (title bar, sidebar, tabs, account row) already exists in the real app and uses
the same `--nw-*` design tokens — it is not rebuilt.

## Goals

- Pixel-faithful recreation of the v2 canvas graph and its floating panels.
- Wired to **real** vault data (`buildGraph(files, cache)`), not the handoff's mock.
- All interactions work: pan, zoom, drag nodes, hover-to-preview, select-to-inspect,
  double-click / "Open note" to open, group show/hide/recolor, live sliders.
- Smart Search integration: real semantic search continues to power the overlay; while
  it is open over the graph, matching notes glow and the hovered result spotlights.
- Groups + slider settings persist per vault.
- Canvas respects light and dark themes.

## Non-goals

- No changes to the native Swift app (`Sources/**`).
- No changes to the title bar, sidebar, tabs, or context panel beyond one added Smart
  Search prop.
- Node positions are **not** persisted (physics re-lays-out on each mount; only
  sliders + group definitions persist).
- No new runtime dependencies (no d3-force / sigma / react-force-graph).

## Approach

Match the handoff: a **hand-rolled canvas engine** (imperative TS module owning the
`<canvas>`) with React only for the surrounding panels and cards. Rejected
alternatives: a graph library (heavy, new dependency, harder to match the design) and
staying on SVG (one React element per node re-rendered every physics tick does not
scale to hundreds of nodes).

## Architecture

New directory `landing/src/workspace/graph/`:

| File | Type | Responsibility |
|------|------|----------------|
| `webEngine.ts` | Pure TS class/factory | The simulation + renderer. Owns node kinematics, camera (pan/zoom/tween), physics `tick`, `draw`, hit-testing, drag, hover. No React, no DOM beyond the injected canvas. Port of the handoff `Component` minus its view. |
| `webGroups.ts` | Pure functions | `match(query, node)`, `applyGroups`, `defaultFolderGroups(nodes)`, `PALETTE`. Unit-tested. |
| `webPersistence.ts` | Pure functions | `loadWebSettings(key)` / `saveWebSettings(key, settings)` — serialize `{ sliders, groups }` to `localStorage` per vault. Tolerates missing/corrupt data. Unit-tested. |
| `webAdjacency.ts` | Pure functions | Build deduped, undirected neighbor lists + link pairs from directed `GraphEdge[]`. Derive per-node `snippet` from `plainText(file.content)`. Unit-tested. |
| `KnowledgeWeb.tsx` | React component | Shell: canvas ref + engine lifecycle (mount/unmount/resize), floating control panel, node info card, hover-preview card, stats footer. Owns persistence load/save and theme observation. |
| `webTypes.ts` | Types | `WebGroup`, `WebSliders`, `WebSettings`, `WebNode` (engine node), `WebSelection`, callback signatures. |

`GraphView.tsx` is deleted; `KnowledgeWeb.tsx` replaces it at the `tab.kind === "graph"`
render site in `NotoWindow.tsx`.

### Engine ↔ React boundary

- React constructs the engine once (`useEffect` on mount) with: the canvas element, the
  graph data (nodes + adjacency + snippets), initial settings, and a callbacks object.
- Callbacks (engine → React): `onSelectionChange(node | null)`, `onHoverPreview(node | null)`,
  `onOpen(fileId)`, `onStats(...)`. React holds selection/preview in state to render the
  cards; the engine drives all canvas drawing itself via `requestAnimationFrame`.
- Commands (React → engine): `setSliders`, `setGroups`, `setHighlight(matchIds, hotId)`,
  `focusNode(fileId)`, `setTheme(colors)`, `resize()`, `destroy()`. React calls these
  imperatively via a ref; they never trigger React re-renders of the canvas.
- The engine reads a small mutable `colors` object (background, cold-edge, label-dim,
  label-bright) so a theme flip is a single command, not a rebuild.

This keeps the hot path (physics + draw, ~60fps) entirely out of React's render cycle;
React re-renders only for panel/card UI changes.

## Data flow

1. `NotoWindow` already computes `fullGraph = buildGraph(files, cache)`.
2. New: build the engine input once per `(fullGraph, files)` change —
   `buildWebModel(fullGraph, files)` → `{ nodes: WebNode[], links, adjacency }` where each
   `WebNode` carries `id (=fileId), title, folder (top path segment), path, degree, ins,
   outs, snippet}`.
3. `KnowledgeWeb` receives the model + `onOpenNote` + Smart Search highlight props.
4. Default groups = one per distinct top-folder, in folder order, colored round-robin
   from `PALETTE`, each with query `path:<Folder>` and `visible: true`. Overridden by
   persisted groups if present for this vault.

Node ↔ file identity is direct (`node.id === file.id`), so open / highlight / select all
key off the same id with no extra lookup table.

## Feature detail (from the handoff)

**Canvas graph.** Force sim: pairwise repulsion (with the handoff's `d2 > 480000`
distance cutoff), spring links at rest length 62, mild gravity to center, velocity
damping. 220-tick warmup on build (capped lower for very large vaults — see
Performance). Node radius scales with `sqrt(degree/maxDegree)` and the Node-size slider.

**Camera.** Wheel = zoom toward cursor (clamped 0.12–6). Drag background = pan. Drag a
node = pin it under the cursor while the sim re-settles (alphaTarget bump), release to
unpin. Cubic-eased tween for programmatic focus.

**Floating control panel** (top-left, collapsible sections):
- *Filters* — a "Search nodes…" input; live title-substring results list; clicking a
  result focus-tweens to that node.
- *Groups* — per group: visibility checkbox, color swatch (click cycles palette), an
  editable query (`path:` prefix matches path start; otherwise title-contains), a live
  match count, and a remove button. "New group" appends a `path:` group. Group
  membership colors nodes; hidden groups remove their nodes from the canvas (and from
  hit-testing, search, and Smart Search matching).
- *Display* — sliders: Node size, Link thickness, Text fade threshold.
- *Forces* — sliders: Center force, Repel force, Link force. Changing a force nudges
  `alpha` up so the sim re-settles.

**Node info card** (bottom-right, when a node is selected): title, path, `links /
backlinks / degree`, and a scrollable neighbor list (each row focus-tweens to that
neighbor). **Adds an "Open note" button** → `onOpenNote(id)`. Close button clears
selection.

**Hover-preview card.** After the node is hovered for `previewDelay` (default 3s,
configurable 1–6s), the camera tweens in (if zoomed out) and a card shows title, path,
links/backlinks, and the real note snippet. Positioned next to the node, flipping side
near the right edge. Suppressed while dragging, panning, tweening, or Smart Search open.

**Dim strength.** Hover/selection fades the rest of the graph by `dimStrength`
(default 0.7).

**Stats footer** (bottom-left): `N notes · M connections · G groups` from real counts.

## Node interaction model (decision)

- **Single click** a node → select it (info card appears; neighbors/edges highlight).
- **Double click** a node → `onOpenNote(id)` (opens the note in a tab).
- **"Open note"** button in the info card → same as double-click.
- Click empty space → clear selection.
- Drag distinguishes from click via a movement threshold (<5px counts as a click), as in
  the handoff.

## Smart Search integration (decision)

Keep `useSmartSearch` (MiniLM embeddings) and `SmartSearchPanel` as the real search.
Additions:

1. `SmartSearchPanel` gains an optional `onHoverResult(fileId | null)` prop; it calls it
   on row mouse-enter/leave (and clears on close). No other behavior change; choosing a
   result still opens the note.
2. `NotoWindow` derives, while `smartOpen`:
   - `smartMatchIds = new Set(smart.results.map(r => r.fileId))`
   - `smartHotId` (from `onHoverResult`)
   and passes both to `KnowledgeWeb`, which forwards them to `engine.setHighlight(...)`.
3. Engine highlight pass (already in the handoff as `ss` / `ssHot`): matched nodes stay
   bright with an accent ring and matched-to-matched edges brighten; unmatched nodes fade;
   the hot node gets a white spotlight ring. Animated via an `ssDim` ease.
4. Only the visible graph lights up — a graph in a hidden/background tab is unmounted, so
   nothing to do there.
5. The global ⌘⇧F handler in `NotoWindow` remains the single source; the engine does
   **not** register its own shortcut.

The handoff's in-file token-matching search is therefore **not** ported; it is replaced
by this bridge to the superior existing feature.

## Persistence (decision)

`webPersistence.ts` stores `{ sliders: WebSliders, groups: WebGroup[] }` under
`noto:web:<vaultKey>` where `vaultKey = persistKey ?? "demo"` (same key space as Smart
Search). Load on mount (fall back to folder defaults if absent/corrupt). Save
(debounced) whenever sliders or groups change. Group queries reference folder names as
plain strings — a since-deleted folder simply yields a zero-count group, no error. Node
positions and camera are never persisted.

## Theme awareness

The handoff hardcodes dark colors. Instead the engine holds a `colors` struct read from
the live `--nw-*` tokens via `getComputedStyle` on the workspace root: background
(`--nw-window`), cold edge + dim label (`--nw-dim`/`--nw-muted`), bright label
(`--nw-ink`), accent (`--nw-accent`). `KnowledgeWeb` re-reads and calls
`engine.setTheme(colors)` when `controller.theme` flips. Group/palette colors are
theme-independent (vivid, legible on both).

## Removed / retired

- `GraphView.tsx` (deleted).
- Filter chips `All / Linked / Orphans` and their plumbing: `WebFilter` type,
  `ws.graphFilter` / `setGraphFilter` in `useWorkspace.ts`, and the
  `visibleGraph`/`filterGraph` call in `NotoWindow.tsx` (pass `fullGraph` model instead).
- `filterGraph` in `noto-core/graph.ts` **stays** (faithful Swift-parity port with tests,
  `graph.test.ts`); it just loses its web-UI caller.

## Performance

O(n²) repulsion per tick. Expected scale is a few hundred nodes — fine with the distance
cutoff. Guard: scale warmup iterations down for large vaults (e.g. `min(220, floor(6e4 /
n))` with a floor) and keep the per-frame cutoff, so a large vault still mounts quickly.
Document the cap in code. Hidden-tab graphs are unmounted (no background CPU).

## Testing

- **Unit (vitest, TDD):** `webGroups` (match semantics incl. `path:` prefix, applyGroups
  counts/colors/hidden, default folder groups), `webPersistence` (round-trip, corrupt/empty
  fallback), `webAdjacency` (dedupe undirected, neighbor lists, snippet derivation).
- **Live (preview browser):** canvas render, pan/zoom/drag, hover preview timing, select
  + info card + open, group show/hide/recolor, sliders, Smart Search highlight + spotlight,
  light/dark. Verified via preview tools, not screenshots-as-proof-of-logic.
- Full `pnpm/npm test` + lint + typecheck green before completion.

## Open risks

- Canvas physics can't be unit-tested; relies on live verification. Mitigated by keeping
  all branchable logic (grouping, adjacency, persistence, highlight-set math) in pure,
  tested modules and keeping the engine a thin imperative layer.
- Very large vaults (>~1500 notes) may need a future Barnes–Hut optimization; out of
  scope now, guarded by the warmup cap.

## File-change summary

**New:** `landing/src/workspace/graph/{webEngine,webGroups,webPersistence,webAdjacency,webTypes}.ts`,
`KnowledgeWeb.tsx`, and `{webGroups,webPersistence,webAdjacency}.test.ts`.
**Modified:** `NotoWindow.tsx` (render site, Smart Search highlight wiring, drop
`visibleGraph`), `smartSearch/SmartSearchPanel.tsx` (`onHoverResult` prop),
`useWorkspace.ts` (drop `graphFilter`), `styles/workspace.css` (graph pane styles as
needed).
**Deleted:** `GraphView.tsx`.
