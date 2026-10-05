'use strict';
// ===== lightweight canvas charts (no libraries, works offline) =====
NS.cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// a series colour may be written 'var(--ch-l)': it is resolved at draw time, so switching theme recolours the chart
NS.col = (c) => { const m = typeof c === 'string' && c.match(/^var\((--[\w-]+)\)$/); return m ? NS.cssVar(m[1]) : c; };

const niceStep = (range, target = 5) => {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
};
const fmtTick = (v, step) => (Math.abs(step) >= 1 ? v.toFixed(0) : v.toFixed(Math.min(4, Math.ceil(-Math.log10(step)))));

class BaseChart {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.dirty = true;
    this.hover = null;
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { this.dirty = true; }).observe(canvas);
    canvas.addEventListener('mousemove', (e) => { const r = canvas.getBoundingClientRect(); this.hover = { x: e.clientX - r.left, y: e.clientY - r.top }; this.dirty = true; });
    canvas.addEventListener('mouseleave', () => { this.hover = null; this.dirty = true; });
  }
  prep() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.c.clientWidth;
    const h = this.c.clientHeight;
    if (!w || !h) return null;
    if (this.c.width !== Math.round(w * dpr) || this.c.height !== Math.round(h * dpr)) { this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  empty(g, w, h) {
    g.font = '13px ' + NS.cssVar('--sans');
    g.fillStyle = NS.cssVar('--muted'); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('ยังไม่มีข้อมูล', w / 2, h / 2);
  }
  axes(g, box, x0, x1, y0, y1, xfmt, yLabel) {
    const ink2 = NS.cssVar('--muted');
    const grid = NS.cssVar('--line');
    const base = NS.cssVar('--line-strong'); // the zero line is one step stronger than the grid
    g.font = '500 11px ' + NS.cssVar('--num');
    g.fillStyle = ink2; g.lineWidth = 1;
    const ys = niceStep(y1 - y0 || 1, 4);
    for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) {
      const y = box.y + box.h - ((v - y0) / (y1 - y0)) * box.h;
      g.strokeStyle = Math.abs(v) < ys * 1e-6 ? base : grid;
      g.beginPath(); g.moveTo(box.x, Math.round(y) + 0.5); g.lineTo(box.x + box.w, Math.round(y) + 0.5); g.stroke();
      g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(fmtTick(v, ys), box.x - 6, y);
    }
    const xs = niceStep(x1 - x0 || 1, 6);
    for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) {
      const x = box.x + ((v - x0) / (x1 - x0)) * box.w;
      g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText(xfmt ? xfmt(v, xs) : fmtTick(v, xs), x, box.y + box.h + 5);
    }
    if (yLabel) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(yLabel, box.x + 4, box.y - 2); }
  }
  legend(g, items, x, y) {
    g.font = '12px ' + NS.cssVar('--sans');
    g.textBaseline = 'middle'; g.textAlign = 'left';
    let cx = x;
    for (const it of items) {
      g.fillStyle = NS.col(it.color); g.fillRect(cx, y - 1, 14, 2.5);
      g.fillStyle = NS.cssVar('--ink2');
      const label = it.value !== undefined ? `${it.label} ${it.value}` : it.label;
      g.fillText(label, cx + 19, y);
      cx += 26 + g.measureText(label).width;
    }
  }
}

// rolling time series; all series on one chart must share a unit (no dual axes)
NS.TimeChart = class extends BaseChart {
  constructor(canvas, opt) {
    super(canvas);
    this.series = opt.series;
    this.win = opt.win || 20;
    this.fixed = opt.y || null;
    this.minSpan = opt.minSpan || 0;
    this.bands = opt.bands || null; // () => [{lo, hi}]
    this.data = new Map(this.series.map((s) => [s.key, []]));
    this.paused = false;
  }
  push(t, obj) {
    if (this.paused) return;
    for (const s of this.series) {
      const v = obj[s.key];
      if (!NS.isNum(v)) continue;
      const arr = this.data.get(s.key);
      arr.push([t, v]);
      const cut = t - 120;
      if (arr.length > 20 && arr[0][0] < cut) { let i = 0; while (i < arr.length && arr[i][0] < cut) i++; arr.splice(0, i); }
    }
    this.last = t;
    this.dirty = true;
  }
  clear() { for (const a of this.data.values()) a.length = 0; this.dirty = true; }
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const p = this.prep();
    if (!p) return;
    const { g, w, h } = p;
    if (![...this.data.values()].some((a) => a.length)) { this.empty(g, w, h); return; }
    const box = { x: 52, y: 22, w: w - 64, h: h - 44 };
    const t1 = this.last || 0;
    const t0 = t1 - this.win;
    let lo = Infinity;
    let hi = -Infinity;
    for (const arr of this.data.values()) for (const [t, v] of arr) if (t >= t0) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (this.fixed) { lo = this.fixed[0]; hi = this.fixed[1]; }
    if (!isFinite(lo)) { lo = -1; hi = 1; }
    if (hi - lo < this.minSpan) { const m = (hi + lo) / 2; lo = m - this.minSpan / 2; hi = m + this.minSpan / 2; }
    if (hi === lo) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    if (!this.fixed) { lo -= pad; hi += pad; }
    const X = (t) => box.x + ((t - t0) / this.win) * box.w;
    const Y = (v) => box.y + box.h - ((v - lo) / (hi - lo)) * box.h;
    if (this.bands) {
      g.fillStyle = NS.cssVar('--ok-fill'); g.globalAlpha = 0.16;
      for (const b of this.bands()) { const ya = Y(Math.min(hi, b.hi)); const yb = Y(Math.max(lo, b.lo)); g.fillRect(box.x, ya, box.w, yb - ya); }
      g.globalAlpha = 1;
    }
    this.axes(g, box, t0 - t1, 0, lo, hi, (v) => `${v.toFixed(0)}s`);
    g.save();
    g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
    for (const s of this.series) {
      const arr = this.data.get(s.key);
      g.strokeStyle = NS.col(s.color); g.lineWidth = s.width || 2; g.lineJoin = 'round';
      if (s.dash) g.setLineDash(s.dash); else g.setLineDash([]);
      g.beginPath();
      let started = false;
      for (const [t, v] of arr) {
        if (t < t0 - 1) continue;
        const x = X(t); const y = Y(v);
        if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.setLineDash([]);
    g.restore();
    const items = this.series.map((s) => {
      const arr = this.data.get(s.key);
      const last = arr.length ? arr[arr.length - 1][1] : NaN;
      return { color: s.color, label: s.label, value: NS.isNum(last) ? last.toFixed(s.dec ?? 2) : '—' };
    });
    this.legend(g, items, box.x, 10);
    if (this.hover && this.hover.x >= box.x && this.hover.x <= box.x + box.w) { // crosshair + values
      const tt = t0 + ((this.hover.x - box.x) / box.w) * this.win;
      g.strokeStyle = NS.cssVar('--muted'); g.globalAlpha = 0.6;
      g.beginPath(); g.moveTo(this.hover.x, box.y); g.lineTo(this.hover.x, box.y + box.h); g.stroke(); g.globalAlpha = 1;
      const lines = [`t = ${(tt - t1).toFixed(2)} s`];
      for (const s of this.series) {
        const arr = this.data.get(s.key);
        let best = null;
        for (const pt of arr) if (!best || Math.abs(pt[0] - tt) < Math.abs(best[0] - tt)) best = pt;
        if (best) lines.push(`${s.label}: ${best[1].toFixed(s.dec ?? 3)}`);
      }
      this.tooltip(g, lines, this.hover.x, this.hover.y, w);
    }
  }
  tooltip(g, lines, x, y, w) {
    g.font = '12px ' + NS.cssVar('--mono');
    const tw = Math.max(...lines.map((l) => g.measureText(l).width)) + 14;
    const th = lines.length * 16 + 8;
    let bx = x + 12;
    if (bx + tw > w) bx = x - tw - 12;
    const by = Math.max(4, y - th / 2);
    g.fillStyle = NS.cssVar('--surface'); g.strokeStyle = NS.cssVar('--line-strong');
    g.fillRect(bx, by, tw, th); g.strokeRect(bx, by, tw, th);
    g.fillStyle = NS.cssVar('--ink'); g.textAlign = 'left'; g.textBaseline = 'top';
    lines.forEach((l, i) => g.fillText(l, bx + 7, by + 5 + i * 16));
  }
};

// x-y chart for calibration data: layers of points and lines
NS.XYChart = class extends BaseChart {
  constructor(canvas, opt = {}) {
    super(canvas);
    this.opt = opt;
    this.layers = [];
  }
  set(layers) { this.layers = layers; this.dirty = true; }
  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const p = this.prep();
    if (!p) return;
    const { g, w, h } = p;
    if (!this.layers.some((L) => L.data.some(([x, y]) => NS.isNum(x) && NS.isNum(y)))) { this.empty(g, w, h); return; }
    const box = { x: 56, y: 24, w: w - 70, h: h - 48 };
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (const L of this.layers) for (const [x, y] of L.data) { if (!NS.isNum(x) || !NS.isNum(y)) continue; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (this.opt.yZero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
    if (!isFinite(x0)) { x0 = -1; x1 = 1; y0 = -1; y1 = 1; }
    if (x1 === x0) { x0 -= 1; x1 += 1; }
    if (y1 === y0) { y0 -= 1; y1 += 1; }
    const py = (y1 - y0) * 0.08; y0 -= py; y1 += py;
    const X = (x) => box.x + ((x - x0) / (x1 - x0)) * box.w;
    const Y = (y) => box.y + box.h - ((y - y0) / (y1 - y0)) * box.h;
    this.axes(g, box, x0, x1, y0, y1, null, this.opt.ylabel);
    g.fillStyle = NS.cssVar('--muted'); g.textAlign = 'right'; g.textBaseline = 'middle';
    if (this.opt.xlabel) g.fillText('แกนนอน: ' + this.opt.xlabel, box.x + box.w, 10);
    g.save(); g.beginPath(); g.rect(box.x - 6, box.y - 6, box.w + 12, box.h + 12); g.clip();
    const surf = NS.cssVar('--surface');
    let nearest = null;
    for (const L of this.layers) {
      if (L.type === 'line') {
        g.strokeStyle = NS.col(L.color); g.lineWidth = L.width || 2; g.setLineDash(L.dash || []);
        g.beginPath();
        L.data.forEach(([x, y], i) => { if (!NS.isNum(y)) return; if (i === 0) g.moveTo(X(x), Y(y)); else g.lineTo(X(x), Y(y)); });
        g.stroke(); g.setLineDash([]);
      } else {
        for (const [x, y] of L.data) {
          if (!NS.isNum(x) || !NS.isNum(y)) continue;
          g.fillStyle = NS.col(L.color); g.strokeStyle = surf; g.lineWidth = 2;
          g.beginPath(); g.arc(X(x), Y(y), L.r || 4, 0, Math.PI * 2); g.fill(); g.stroke();
          if (this.hover) {
            const d = Math.hypot(X(x) - this.hover.x, Y(y) - this.hover.y);
            if (d < 14 && (!nearest || d < nearest.d)) nearest = { d, x, y, label: L.label };
          }
        }
      }
    }
    g.restore();
    this.legend(g, this.layers.filter((L) => L.label).map((L) => ({ color: L.color, label: L.label })), box.x, 10);
    if (nearest) TimeChartTooltip(g, [`${nearest.label}`, `x = ${nearest.x.toFixed(3)}`, `y = ${nearest.y.toFixed(4)}`], this.hover.x, this.hover.y, w);
  }
};
function TimeChartTooltip(g, lines, x, y, w) { NS.TimeChart.prototype.tooltip.call(null, g, lines, x, y, w); }
