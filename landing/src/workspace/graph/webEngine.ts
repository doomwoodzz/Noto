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
