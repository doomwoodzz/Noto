import { useMemo } from "react";
import type { KnowledgeGraph } from "../noto-core";

export type WebFilter = "all" | "linked" | "orphans";

interface Props {
  graph: KnowledgeGraph;
  focusId: string;
  filter: WebFilter;
  setFilter: (f: WebFilter) => void;
  onSelect: (id: string) => void;
}

const W = 920;
const H = 600;
const CHIPS: [WebFilter, string][] = [
  ["all", "All notes"],
  ["linked", "Linked"],
  ["orphans", "Orphans"],
];

function topFolder(path: string): string {
  return path.split("/")[0] || "Notes";
}

export function GraphView({ graph, focusId, filter, setFilter, onSelect }: Props) {
  // Folder-clustered layout, computed once per graph (stable across filters).
  const pos = useMemo(() => {
    const cx = W / 2;
    const cy = H / 2;
    const byFolder = new Map<string, typeof graph.nodes>();
    for (const n of graph.nodes) {
      const f = topFolder(n.path);
      if (!byFolder.has(f)) byFolder.set(f, []);
      byFolder.get(f)!.push(n);
    }
    const folders = [...byFolder.keys()];
    const out: Record<string, { x: number; y: number }> = {};
    folders.forEach((folder, i) => {
      const list = byFolder.get(folder)!;
      const a = (i / Math.max(folders.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const ccx = cx + Math.cos(a) * 255;
      const ccy = cy + Math.sin(a) * 168;
      if (list.length === 1) {
        out[list[0].id] = { x: ccx, y: ccy };
      } else {
        list.forEach((n, j) => {
          const aa = (j / list.length) * Math.PI * 2 + i;
          const rr = 52 + list.length * 7;
          out[n.id] = { x: ccx + Math.cos(aa) * rr, y: ccy + Math.sin(aa) * rr };
        });
      }
    });
    // Pull the focused note toward the centre so it anchors the view.
    if (out[focusId]) out[focusId] = { x: cx - 30, y: cy - 6 };
    return out;
  }, [graph, focusId]);

  const visible = (degree: number) =>
    filter === "all" ? true : filter === "linked" ? degree > 0 : degree === 0;

  const degreeById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const n of graph.nodes) m[n.id] = n.degree;
    return m;
  }, [graph]);

  return (
    <div className="nw-web">
      <div className="nw-web-head">
        <div>
          <h1 className="nw-web-title">Knowledge Web</h1>
          <div className="nw-web-sub">
            {graph.nodes.length} notes · {graph.edges.length} connections · generated from your links
          </div>
        </div>
        <div className="nw-web-chips">
          {CHIPS.map(([id, label]) => (
            <button
              key={id}
              className={"nw-web-chip" + (filter === id ? " is-active" : "")}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="nw-web-canvas-wrap">
        <div className="nw-web-canvas">
          <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
            <g>
              {graph.edges.map((ed, i) => {
                const s = pos[ed.source];
                const t = pos[ed.target];
                if (!s || !t) return null;
                if (!visible(degreeById[ed.source] ?? 0) || !visible(degreeById[ed.target] ?? 0)) return null;
                const mx = (s.x + t.x) / 2 + (i % 2 ? 26 : -26);
                const my = (s.y + t.y) / 2 - 22;
                const hot = ed.source === focusId || ed.target === focusId;
                return (
                  <path
                    key={ed.id}
                    d={`M${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}`}
                    fill="none"
                    stroke={hot ? "rgba(87,143,250,0.5)" : "rgba(143,153,174,0.18)"}
                    strokeWidth={hot ? 1.6 : 1}
                  />
                );
              })}
            </g>
            <g>
              {graph.nodes.map((n) => {
                const p = pos[n.id];
                if (!p || !visible(n.degree)) return null;
                const r = Math.max(15, Math.min(42, 15 + n.degree * 5));
                const isF = n.id === focusId;
                const accent = n.degree >= 2;
                const fill = isF
                  ? "rgba(87,143,250,0.92)"
                  : accent
                    ? `rgba(87,143,250,${Math.min(0.42, 0.13 + n.degree * 0.05)})`
                    : "rgba(143,153,174,0.10)";
                const stroke = isF
                  ? "rgba(150,185,255,0.95)"
                  : accent
                    ? "rgba(87,143,250,0.55)"
                    : "rgba(143,153,174,0.38)";
                return (
                  // The focused node is the note you're already viewing and is
                  // pinned dead-centre, so a stray click where the graph opens
                  // would otherwise bounce you straight back into that note.
                  // Make it inert; every other node still navigates.
                  <g
                    key={n.id}
                    onClick={isF ? undefined : () => onSelect(n.id)}
                    style={{ cursor: isF ? "default" : "pointer" }}
                  >
                    {isF && <circle cx={p.x} cy={p.y} r={r + 9} fill="none" stroke="rgba(87,143,250,0.28)" strokeWidth={1.4} />}
                    <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke={stroke} strokeWidth={1.4} />
                    <text
                      x={p.x}
                      y={p.y + r + 16}
                      textAnchor="middle"
                      fill={isF ? "#EBF0FA" : "#9AA4B6"}
                      fontFamily="Inter, system-ui"
                      fontSize={12.5}
                      fontWeight={isF ? 600 : 500}
                    >
                      {n.title}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}
