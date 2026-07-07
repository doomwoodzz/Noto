// The Knowledge Web view: a canvas force-directed graph (driven by WebEngine)
// plus the floating control panel, node info card, hover-preview card, and stats.
// Engine runs the hot path outside React; this component renders chrome and drives
// the engine imperatively via a ref.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  useLayoutEffect(() => {
    latest.current = { styling, sliders, onOpenNote, smartMatchIds, smartHotId, smartOpen };
  });

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
