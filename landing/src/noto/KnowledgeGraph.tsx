import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  createInitialGraphBodies,
  dragGraphCluster,
  reconcileGraphBodies,
  stepGraphBodies,
  type GraphPoint,
} from "./KnowledgeGraphPhysics";
import { edgeKey } from "./aiDemo";
import type { Graph, GraphFilter, GraphNode } from "./types";

interface KnowledgeGraphProps {
  graph: Graph;
  activeFileId: string;
  onSelect: (id: string) => void;
  filter: GraphFilter;
  setFilter: (f: GraphFilter) => void;
  createdEdgeKeys: Set<string>;
  createdNodeIds: Set<string>;
  linksAnimating: boolean;
}

const FILTERS: { id: GraphFilter; label: string }[] = [
  { id: "all", label: "All notes" },
  { id: "local", label: "Local" },
  { id: "lecture", label: "Lectures" },
  { id: "orphan", label: "Orphans" },
];

export function KnowledgeGraph({
  graph, activeFileId, onSelect, filter, setFilter,
  createdEdgeKeys, createdNodeIds, linksAnimating,
}: KnowledgeGraphProps) {
  const W = 880;
  const H = 540;
  const bounds = useMemo(() => ({ width: W, height: H, padding: 54 }), []);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ id: string; last: GraphPoint; moved: boolean } | null>(null);
  const grabbedIdRef = useRef<string | null>(null);
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [bodies, setBodies] = useState(() => createInitialGraphBodies(graph, activeFileId, bounds));

  // Play the "links being drawn" pulse whenever AI links are present. The
  // pulse starts on mount (re-opening the view replays it) and is also driven
  // by `linksAnimating` for the case where links appear while already open.
  const [mountPulse, setMountPulse] = useState(() => createdEdgeKeys.size > 0);
  useEffect(() => {
    if (!mountPulse) return;
    const t = setTimeout(() => setMountPulse(false), 5200);
    return () => clearTimeout(t);
  }, [mountPulse]);
  const showPulse = mountPulse || linksAnimating;

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();

    function animate(now: number) {
      const dt = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      setBodies(current => {
        const reconciled = reconcileGraphBodies(current, graph, activeFileId, bounds);
        return stepGraphBodies(reconciled, graph.edges, bounds, dt, grabbedIdRef.current);
      });
      frame = requestAnimationFrame(animate);
    }

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [activeFileId, bounds, graph]);

  function nodeSize(n: GraphNode) { return 18 + Math.min(n.degree, 8) * 4; }

  function graphPoint(event: PointerEvent<SVGGElement>): GraphPoint | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const transform = svg.getScreenCTM();
    if (!transform) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(transform.inverse());
  }

  function beginDrag(event: PointerEvent<SVGGElement>, id: string) {
    const point = graphPoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { id, last: point, moved: false };
    grabbedIdRef.current = id;
    setGrabbedId(id);
  }

  function moveDrag(event: PointerEvent<SVGGElement>) {
    const drag = dragRef.current;
    const point = graphPoint(event);
    if (!drag || !point) return;
    const delta = { x: point.x - drag.last.x, y: point.y - drag.last.y };
    if (Math.hypot(delta.x, delta.y) > 0.2) {
      drag.moved = true;
      drag.last = point;
      setBodies(current => dragGraphCluster(current, graph.edges, drag.id, delta, bounds));
    }
  }

  function endDrag(event: PointerEvent<SVGGElement>, id: string) {
    const drag = dragRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    grabbedIdRef.current = null;
    setGrabbedId(null);
    if (!drag?.moved) onSelect(id);
  }

  return (
    <div className="noto-graph">
      <div className="noto-graph-head">
        <div>
          <div className="noto-graph-title">Knowledge Web</div>
          <div className="noto-graph-sub">Generated from Markdown wiki links and backlinks.</div>
        </div>
        <div className="noto-segmented">
          {FILTERS.map(f => (
            <button
              key={f.id}
              className={"noto-segment" + (filter === f.id ? " is-active" : "")}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} className="noto-graph-svg" preserveAspectRatio="xMidYMid meet">
        <g>
          {graph.edges.map((e, i) => {
            const s = bodies[e.source], t = bodies[e.target];
            if (!s || !t) return null;
            const created = createdEdgeKeys.has(edgeKey(e));
            return (
              <g key={i}>
                <line
                  x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                  className={created ? "noto-edge-created" : undefined}
                  stroke={created ? "rgba(125,170,255,0.7)" : "rgba(87,143,250,0.34)"}
                  strokeWidth={created ? 1.8 : 1.4}
                />
                {created && showPulse && (
                  <line
                    x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                    className="noto-edge-pulse"
                    stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round"
                    pathLength={1} strokeDasharray="0.16 0.84"
                  />
                )}
              </g>
            );
          })}
        </g>
        <g>
          {graph.nodes.map(n => {
            const p = bodies[n.id]; if (!p) return null;
            const isActive = n.id === activeFileId;
            const isGrabbed = n.id === grabbedId;
            const isCreated = createdNodeIds.has(n.id);
            const r = nodeSize(n);
            return (
              <g
                key={n.id}
                className={"noto-graph-node" + (isCreated ? " noto-graph-node-created" : "")}
                onPointerDown={(event) => beginDrag(event, n.id)}
                onPointerMove={moveDrag}
                onPointerUp={(event) => endDrag(event, n.id)}
                onPointerCancel={(event) => endDrag(event, n.id)}
                style={{ cursor: isGrabbed ? "grabbing" : "grab" }}
              >
                {isCreated && showPulse && (
                  <circle cx={p.x} cy={p.y} r={r} className="noto-node-ring" fill="none" stroke="#ffffff" />
                )}
                <circle cx={p.x} cy={p.y} r={r}
                  fill={isActive ? "#578FFA" : isCreated ? "#2C3340" : "#22252A"}
                  stroke={isGrabbed ? "rgba(235,240,250,0.9)" : isCreated ? "rgba(125,170,255,0.85)" : "rgba(87,143,250,0.62)"}
                  strokeWidth={isGrabbed ? "1.6" : isCreated ? "1.5" : "1"} />
                <text x={p.x} y={p.y + r + 16} textAnchor="middle"
                  fill="#EBF0FA"
                  fontFamily="Inter, system-ui"
                  fontSize="12"
                  fontWeight={isActive ? 600 : 400}>
                  {n.title}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
