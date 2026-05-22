import type { Graph, GraphFilter, GraphNode } from "./types";

interface KnowledgeGraphProps {
  graph: Graph;
  activeFileId: string;
  onSelect: (id: string) => void;
  filter: GraphFilter;
  setFilter: (f: GraphFilter) => void;
}

const FILTERS: { id: GraphFilter; label: string }[] = [
  { id: "all", label: "All notes" },
  { id: "local", label: "Local" },
  { id: "lecture", label: "Lectures" },
  { id: "orphan", label: "Orphans" },
];

export function KnowledgeGraph({ graph, activeFileId, onSelect, filter, setFilter }: KnowledgeGraphProps) {
  const W = 880;
  const H = 540;
  const center = { x: W / 2, y: H / 2 };
  const radius = Math.max(160, Math.min(W, H) * 0.34);

  const sorted = [...graph.nodes].sort((a, b) => {
    if (a.id === activeFileId) return -1;
    if (b.id === activeFileId) return 1;
    return a.title.localeCompare(b.title);
  });
  const activeIsVisible = sorted.some(n => n.id === activeFileId);
  const ringCount = activeIsVisible ? sorted.length - 1 : sorted.length;

  const positions: Record<string, { x: number; y: number }> = {};
  let ringIndex = 0;
  for (const n of sorted) {
    if (n.id === activeFileId) { positions[n.id] = center; continue; }
    const angle = (ringIndex / Math.max(ringCount, 1)) * Math.PI * 2 - Math.PI / 2;
    const adjusted = radius + (n.degree % 3) * 22;
    positions[n.id] = {
      x: center.x + Math.cos(angle) * adjusted,
      y: center.y + Math.sin(angle) * adjusted,
    };
    ringIndex++;
  }

  function nodeSize(n: GraphNode) { return 18 + Math.min(n.degree, 8) * 4; }

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

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="noto-graph-svg" preserveAspectRatio="xMidYMid meet">
        <g>
          {graph.edges.map((e, i) => {
            const s = positions[e.source], t = positions[e.target];
            if (!s || !t) return null;
            return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke="rgba(87,143,250,0.34)" strokeWidth="1.4" />;
          })}
        </g>
        <g>
          {graph.nodes.map(n => {
            const p = positions[n.id]; if (!p) return null;
            const isActive = n.id === activeFileId;
            const r = nodeSize(n);
            return (
              <g key={n.id} onClick={() => onSelect(n.id)} style={{ cursor: "pointer" }}>
                <circle cx={p.x} cy={p.y} r={r}
                  fill={isActive ? "#578FFA" : "#22252A"}
                  stroke="rgba(87,143,250,0.62)" strokeWidth="1" />
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
