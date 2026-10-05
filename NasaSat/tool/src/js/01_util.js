'use strict';
// ===== util: helpers shared by every module (works in browser and Node tests) =====
const NS = (globalThis.NS = globalThis.NS || {});
NS.VERSION = '0.1.0';
NS.DEG = Math.PI / 180;
NS.RAD = 180 / Math.PI;
NS.clamp = (x, a, b) => Math.min(b, Math.max(a, x));
NS.isNum = (x) => typeof x === 'number' && isFinite(x);
NS.fmt = (x, d = 2) => (NS.isNum(x) ? x.toFixed(d) : '—');
NS.sum = (a) => a.reduce((s, v) => s + v, 0);
NS.mean = (a) => (a.length ? NS.sum(a) / a.length : NaN);
NS.std = (a) => {
  if (a.length < 2) return 0;
  const m = NS.mean(a);
  return Math.sqrt(NS.sum(a.map((v) => (v - m) * (v - m))) / (a.length - 1));
};
NS.median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
NS.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// tiny event bus
NS.bus = (() => {
  const m = new Map();
  return {
    on(e, f) { if (!m.has(e)) m.set(e, new Set()); m.get(e).add(f); return () => m.get(e).delete(f); },
    emit(e, d) { const s = m.get(e); if (s) for (const f of [...s]) { try { f(d); } catch (err) { console.error(err); } } },
  };
})();

// localStorage wrapper (per-viewer conveniences only; may be unavailable)
NS.store = {
  get(k, d) { try { const v = localStorage.getItem('nasasat.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('nasasat.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
};

NS.pad2 = (n) => String(n).padStart(2, '0');
NS.clock = (ms) => {
  const d = ms ? new Date(ms) : new Date();
  return `${NS.pad2(d.getHours())}:${NS.pad2(d.getMinutes())}:${NS.pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};
NS.fileStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}${NS.pad2(d.getMonth() + 1)}${NS.pad2(d.getDate())}_${NS.pad2(d.getHours())}${NS.pad2(d.getMinutes())}${NS.pad2(d.getSeconds())}`;
};

if (typeof document !== 'undefined') {
  NS.$ = (sel, root = document) => root.querySelector(sel);
  NS.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  NS.el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) e.setAttribute(k, v);
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined) e.append(c.nodeType ? c : String(c));
    return e;
  };
  NS.download = (name, data, type = 'text/plain;charset=utf-8') => {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };
  NS.copyText = async (t) => {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = t; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      ta.remove(); return ok;
    }
  };
  // every red toast is also a "problem": the app (NS.onProblem) keeps it in the tray until someone acknowledges it
  NS.toast = (msg, kind = '', ms = 3500) => {
    if (kind === 'bad' && NS.onProblem) { try { NS.onProblem(msg); } catch (e) { console.error(e); } }
    const box = document.getElementById('toasts');
    if (!box) return;
    const t = NS.el('div', { class: 'toast ' + kind, text: msg });
    box.append(t);
    setTimeout(() => t.remove(), ms);
  };
  NS.kv = (container, obj) => {
    container.classList.remove('muted');
    container.replaceChildren();
    for (const [k, v] of Object.entries(obj)) {
      container.append(NS.el('div', { text: k }), NS.el('div', { text: v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v) }));
    }
  };
  NS.readFileText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(file); });
}

// Mission-1 pass rule over the hold window (pure, unit-tested): every sample must be HOLD, valid, unsaturated and
// inside ±tol; the stream must not stop for more than 0.5 s; at least 80 % of the expected samples must arrive.
NS.m1Judge = (hold, o) => {
  const h = hold || { samples: [], maxGap: Infinity, last: -Infinity, holdS: 3 };
  const tol = o.tol;
  const smp = h.samples;
  const errs = smp.map((s) => s.err).filter(NS.isNum);
  const need = Math.floor(h.holdS * Math.max(1, o.hz) * 0.8);
  const gap = Math.max(h.maxGap, o.now - h.last);
  const why = [];
  if (smp.length < need) why.push(`sample ไม่พอ ${smp.length}/${need}`);
  if (gap > 0.5) why.push(`ข้อมูลขาด ${NS.isNum(gap) && gap < 1e6 ? gap.toFixed(1) : '∞'} s`);
  const nNotHold = smp.filter((s) => s.st !== 3).length;
  if (nNotHold) why.push(`หลุด HOLD ${nNotHold} ครั้ง`);
  const nBad = smp.filter((s) => !s.valid || s.sat).length;
  if (nBad) why.push(`ไม่เห็นแสง/ADC ตัน ${nBad} ครั้ง`);
  const nOut = smp.filter((s) => !(Math.abs(s.err) <= tol)).length;
  if (nOut) why.push(`เกินเกณฑ์ ${nOut} ครั้ง`);
  return {
    pass: why.length === 0, why, tol, holdS: h.holdS, n: smp.length, need,
    mean: NS.mean(errs), sd: NS.std(errs), maxAbs: errs.length ? Math.max(...errs.map(Math.abs)) : NaN,
  };
};
