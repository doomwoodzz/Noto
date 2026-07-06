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
