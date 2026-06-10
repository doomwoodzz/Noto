import type { Graph, GraphEdge } from "./types";

export interface GraphBounds {
  width: number;
  height: number;
  padding: number;
}

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphBody extends GraphPoint {
  vx: number;
  vy: number;
  phase: number;
}

export type GraphBodies = Record<string, GraphBody>;

const MAX_SPEED = 14;
const DRIFT_FORCE = 3.8;
const DAMPING = 0.992;
const EDGE_PULL = 0.018;
const EDGE_DISTANCE = 182;
const CENTER_PULL = 0.006;
const NODE_REPEL = 780;
const MIN_NODE_DISTANCE = 78;

export function createInitialGraphBodies(graph: Graph, activeFileId: string, bounds: GraphBounds): GraphBodies {
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  const radius = Math.max(120, Math.min(bounds.width, bounds.height) * 0.34);
  const sorted = [...graph.nodes].sort((a, b) => {
    if (a.id === activeFileId) return -1;
    if (b.id === activeFileId) return 1;
    return a.title.localeCompare(b.title);
  });
  const activeIsVisible = sorted.some(n => n.id === activeFileId);
  const ringCount = activeIsVisible ? sorted.length - 1 : sorted.length;
  const bodies: GraphBodies = {};
  let ringIndex = 0;

  for (const node of sorted) {
    let point = center;
    if (node.id !== activeFileId) {
      const angle = (ringIndex / Math.max(ringCount, 1)) * Math.PI * 2 - Math.PI / 2;
      const adjusted = radius + (node.degree % 3) * 22;
      point = {
        x: center.x + Math.cos(angle) * adjusted,
        y: center.y + Math.sin(angle) * adjusted,
      };
      ringIndex += 1;
    }

    const seed = seededUnit(node.id);
    bodies[node.id] = {
      ...clampPoint(point, bounds),
      vx: Math.cos(seed * Math.PI * 2) * 2.4,
      vy: Math.sin(seed * Math.PI * 2) * 2.4,
      phase: seed * Math.PI * 2,
    };
  }

  return bodies;
}

export function reconcileGraphBodies(previous: GraphBodies, graph: Graph, activeFileId: string, bounds: GraphBounds): GraphBodies {
  const initial = createInitialGraphBodies(graph, activeFileId, bounds);
  const next: GraphBodies = {};

  for (const node of graph.nodes) {
    next[node.id] = previous[node.id]
      ? { ...previous[node.id], ...clampPoint(previous[node.id], bounds) }
      : initial[node.id];
  }

  return next;
}

export function dragGraphCluster(
  bodies: GraphBodies,
  edges: GraphEdge[],
  nodeId: string,
  delta: GraphPoint,
  bounds: GraphBounds,
): GraphBodies {
  const cluster = connectedNodeIds(edges, nodeId);
  const next = cloneBodies(bodies);

  for (const id of cluster) {
    const body = next[id];
    if (!body) continue;
    const point = clampPoint({ x: body.x + delta.x, y: body.y + delta.y }, bounds);
    body.x = point.x;
    body.y = point.y;
    body.vx = clamp(delta.x * 10, -MAX_SPEED, MAX_SPEED);
    body.vy = clamp(delta.y * 10, -MAX_SPEED, MAX_SPEED);
  }

  return next;
}

export function stepGraphBodies(
  bodies: GraphBodies,
  edges: GraphEdge[],
  bounds: GraphBounds,
  dt: number,
  grabbedId: string | null,
): GraphBodies {
  const next = cloneBodies(bodies);
  const forces: Record<string, GraphPoint> = {};
  const center = { x: bounds.width / 2, y: bounds.height / 2 };

  for (const id of Object.keys(next)) {
    forces[id] = {
      x: (center.x - next[id].x) * CENTER_PULL,
      y: (center.y - next[id].y) * CENTER_PULL,
    };
  }

  for (const edge of edges) {
    const source = next[edge.source];
    const target = next[edge.target];
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const pull = (distance - EDGE_DISTANCE) * EDGE_PULL;
    const fx = (dx / distance) * pull;
    const fy = (dy / distance) * pull;
    forces[edge.source].x += fx;
    forces[edge.source].y += fy;
    forces[edge.target].x -= fx;
    forces[edge.target].y -= fy;
  }

  const ids = Object.keys(next);
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = next[ids[i]];
      const b = next[ids[j]];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      if (distance >= MIN_NODE_DISTANCE) continue;
      const push = (1 - distance / MIN_NODE_DISTANCE) * NODE_REPEL;
      const fx = (dx / distance) * push;
      const fy = (dy / distance) * push;
      forces[ids[i]].x -= fx;
      forces[ids[i]].y -= fy;
      forces[ids[j]].x += fx;
      forces[ids[j]].y += fy;
    }
  }

  for (const [id, body] of Object.entries(next)) {
    if (id === grabbedId) {
      body.vx = 0;
      body.vy = 0;
      continue;
    }

    const driftX = Math.cos(body.phase + body.y * 0.011) * DRIFT_FORCE;
    const driftY = Math.sin(body.phase + body.x * 0.009) * DRIFT_FORCE;
    body.vx = clamp((body.vx + (forces[id].x + driftX) * dt) * DAMPING, -MAX_SPEED, MAX_SPEED);
    body.vy = clamp((body.vy + (forces[id].y + driftY) * dt) * DAMPING, -MAX_SPEED, MAX_SPEED);
    const point = clampPoint({ x: body.x + body.vx * dt, y: body.y + body.vy * dt }, bounds);
    body.x = point.x;
    body.y = point.y;
    body.phase += dt * 0.7;

    if (point.x === bounds.padding || point.x === bounds.width - bounds.padding) body.vx *= -0.55;
    if (point.y === bounds.padding || point.y === bounds.height - bounds.padding) body.vy *= -0.55;
  }

  return next;
}

function connectedNodeIds(edges: GraphEdge[], nodeId: string): Set<string> {
  const connected = new Set<string>([nodeId]);
  for (const edge of edges) {
    if (edge.source === nodeId) connected.add(edge.target);
    if (edge.target === nodeId) connected.add(edge.source);
  }
  return connected;
}

function cloneBodies(bodies: GraphBodies): GraphBodies {
  const next: GraphBodies = {};
  for (const [id, body] of Object.entries(bodies)) next[id] = { ...body };
  return next;
}

function clampPoint(point: GraphPoint, bounds: GraphBounds): GraphPoint {
  return {
    x: clamp(point.x, bounds.padding, bounds.width - bounds.padding),
    y: clamp(point.y, bounds.padding, bounds.height - bounds.padding),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function seededUnit(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
