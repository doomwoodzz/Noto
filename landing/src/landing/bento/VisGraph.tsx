// Radial graph mock matching the Noto knowledge web look.
interface GraphNode {
  id: string;
  label: string;
  r?: number;
  active?: boolean;
  angle?: number;
}

const NODES: GraphNode[] = [
  { id: "ph", label: "Photosynthesis", r: 26, active: true },
  { id: "cl", label: "Chloroplast", angle: 30 },
  { id: "gl", label: "Glucose", angle: 90 },
  { id: "co", label: "Carbon Dioxide", angle: 150 },
  { id: "cs", label: "Cell Structure", angle: 210 },
  { id: "en", label: "Enzymes", angle: 270 },
  { id: "lc", label: "Biology Lecture", angle: 330 },
];

export function VisGraph() {
  const W = 520, H = 320;
  const cx = W / 2, cy = H / 2;
  const radius = 110;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const n of NODES) {
    if (n.active) { pos[n.id] = { x: cx, y: cy }; continue; }
    const a = (n.angle ?? 0) * Math.PI / 180;
    pos[n.id] = { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius };
  }
  const edges: [string, string][] = NODES.filter(n => !n.active).map(n => ["ph", n.id]);
  edges.push(["cl", "lc"], ["gl", "lc"], ["cs", "cl"]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
      <g>
        {edges.map(([a, b], i) => {
          const s = pos[a], t = pos[b];
          if (!s || !t) return null;
          return <line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y}
            stroke="rgba(87,143,250,0.45)" strokeWidth="1.2" />;
        })}
      </g>
      <g>
        {NODES.map(n => {
          const p = pos[n.id];
          const r = n.active ? 22 : 12;
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={r}
                className={n.active ? "lr-graph-node lr-graph-node-active" : "lr-graph-node"}
                fill={n.active ? "#578FFA" : "#FFFFFF"}
                stroke={n.active ? "rgba(87,143,250,0.6)" : "rgba(87,143,250,0.55)"} strokeWidth="1.4" />
              <text x={p.x} y={p.y + r + 14} textAnchor="middle"
                className="lr-graph-label"
                fill="#0C0D0F" fontFamily="Inter, sans-serif"
                fontSize="11" fontWeight={n.active ? 600 : 500}>
                {n.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}
