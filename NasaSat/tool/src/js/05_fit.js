'use strict';
// ===== calibration math: Levenberg–Marquardt, physical sensor model, LUT, metrics =====
NS.fit = {};

const sumsq = (r) => { let s = 0; for (const v of r) s += v * v; return s; };

NS.fit.solve = (A, b) => { // Gaussian elimination with partial pivoting
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
};

NS.fit.lm = (resid, p0, opt = {}) => {
  const lo = opt.lo || p0.map(() => -Infinity);
  const hi = opt.hi || p0.map(() => Infinity);
  const free = opt.free || p0.map(() => true);
  const idx = [];
  free.forEach((f, i) => f && idx.push(i));
  let p = p0.map((v, i) => NS.clamp(v, lo[i], hi[i]));
  let r = resid(p);
  let cost = sumsq(r);
  let lam = opt.lambda0 || 1e-3;
  const maxIter = opt.maxIter || 300;
  let it = 0;
  for (; it < maxIter; it++) {
    const m = r.length;
    const n = idx.length;
    const J = [];
    for (let j = 0; j < n; j++) {
      const i = idx[j];
      const h = (opt.h && opt.h[i]) || 1e-5 * Math.max(1, Math.abs(p[i]));
      const pp = p.slice();
      pp[i] = p[i] + h > hi[i] ? p[i] - h : p[i] + h;
      const d = pp[i] - p[i];
      const r2 = resid(pp);
      J.push(r2.map((v, k) => (v - r[k]) / d));
    }
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    for (let a = 0; a < n; a++) {
      for (let k = 0; k < m; k++) g[a] += J[a][k] * r[k];
      for (let b = a; b < n; b++) {
        let s = 0;
        for (let k = 0; k < m; k++) s += J[a][k] * J[b][k];
        A[a][b] = s; A[b][a] = s;
      }
    }
    let improved = false;
    let tiny = false;
    for (let tries = 0; tries < 14; tries++) {
      const Ad = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lam) + 1e-12 : v)));
      const dp = NS.fit.solve(Ad, g.map((v) => -v));
      if (!dp || dp.some((v) => !isFinite(v))) { lam *= 10; continue; }
      const pn = p.slice();
      idx.forEach((i, j) => { pn[i] = NS.clamp(p[i] + dp[j], lo[i], hi[i]); });
      const rn = resid(pn);
      const cn = sumsq(rn);
      if (isFinite(cn) && cn < cost) {
        tiny = (cost - cn) / Math.max(cost, 1e-30) < 1e-12;
        p = pn; r = rn; cost = cn;
        lam = Math.max(lam / 3, 1e-12);
        improved = true;
        break;
      }
      lam *= 4;
    }
    if (!improved || tiny) break;
  }
  return { p, cost, iters: it, rms: Math.sqrt(cost / Math.max(1, r.length)) };
};

// ---- physical model of the V-shaped LDR pair ----
// theta = phi - ang : light angle relative to the sensor-pair bisector (deg)
// lamp part seen by each LDR:  P_L = A_L*cos^qL(theta - alpha) ,  P_R = A_R*cos^qR(theta + alpha)   (q = housing shape)
// each LDR has its own gamma, and room light adds to the lamp BEFORE the power law:
//   G_L = (P_L + aL)^gL ,  G_R = (P_R + aR)^gR
// (after the q-roots each channel is a pure cosine, so the gain between channels g = A_R^(1/qR) / A_L^(1/qL)
//  does not depend on lamp brightness; a gamma per LDR is a small refinement, ~0.02-0.03 deg in tests)
NS.fit.model = (P, ang) => {
  const th = P.phi - ang;
  const cL = Math.cos((th - P.alpha) * NS.DEG);
  const cR = Math.cos((th + P.alpha) * NS.DEG);
  const EL = Math.exp(P.lnAL) * Math.pow(Math.max(cL, 0) + 1e-4, P.qL) + P.aL;
  const ER = Math.exp(P.lnAR) * Math.pow(Math.max(cR, 0) + 1e-4, P.qR) + P.aR;
  return { GL: Math.pow(EL, P.gL), GR: Math.pow(ER, P.gR) };
};

const KEYS = ['phi', 'alpha', 'qL', 'qR', 'lnAL', 'lnAR', 'aL', 'aR', 'gL', 'gR'];
const pack = (P) => KEYS.map((k) => P[k]);
const unpack = (v) => Object.fromEntries(KEYS.map((k, i) => [k, v[i]]));

// pts: [{ang, GL, GR}] ; o: {gamma, alpha0, fitQ, fitGamma, sameQ, gRatio, amb:{aL,aR,GL?,GR?}|null, frac}
// amb = lamp-off measurement (step 2). Its conductances fix the room light for any gamma; when it is known
// each LDR's gamma is fitted too (room light gives the leverage), gently pulled toward the datasheet value.
// Only the lamp-lit part of each channel (>= frac of its peak, room light REMOVED) is fitted: the tails are
// dominated by the housing cut-off, which the model does not include. Counting room light as lamp light here
// (the first version did) lets those tails in: in a lit room (ambient 30 % of the lamp) that biased the lamp
// direction by ~8 deg and gave 8-22 deg errors; with room light removed the same data gives ~0.3 deg.
//
// Brightness invariance (audit 30 Sep, F04): a sweep at one lamp brightness only fixes each channel's product
// gamma*q, not the split. The estimator's channel value grows like K^(gamma_true / (gamma_est * q_est)); with matched
// products that is K^(1/q_true), so the lamp brightness K cancels in D only if the two housings have the same shape.
// In a lit room it also needs gamma_est/gamma_true equal in both channels, or the room light is subtracted unevenly
// (the e2e world, identical housings: 0.5 deg when the lamp is 0.45x as bright; uneven housings: 3-4 deg).
// The cure is gRatio = gammaR/gammaL measured at two lamp brightnesses (NS.fit.gammaRatio) with ONE q for both
// channels (sameQ, on by default when gRatio is given). Probe of 8 worlds (housing shapes 1.35/1.35 .. 1.2/1.6,
// room light 3 % and 30 %), lamp 0.25x..4x: the zero moves <= 0.4 deg with it, up to 14 deg without it.
// sameQ WITHOUT a measured ratio was worse than free q (1.1 deg vs 0.5 deg in a lit room), so it is not the default.
NS.fit.fitPhysical = (pts, o = {}) => {
  const good = pts.filter((p) => p.GL > 0 && p.GR > 0 && isFinite(p.GL) && isFinite(p.GR) && !p.sat);
  if (good.length < 6) throw new Error('ข้อมูลน้อยเกินไป (ต้องมีอย่างน้อย 6 จุด)');
  const gamma0 = o.gamma || 0.6;
  const ig = 1 / gamma0;
  const E = good.map((p) => ({ L: Math.pow(p.GL, ig), R: Math.pow(p.GR, ig) }));
  const maxL = Math.max(...E.map((e) => e.L));
  const maxR = Math.max(...E.map((e) => e.R));
  const angs = good.map((p) => p.ang);
  const span = Math.max(...angs) - Math.min(...angs);

  // room light as conductance: from AMB (lamp off) if measured; otherwise a channel's dimmest reading, but only
  // when the sweep really reached angles where that LDR no longer sees the lamp (else 0: q absorbs it)
  const minGL = Math.min(...good.map((p) => p.GL));
  const minGR = Math.min(...good.map((p) => p.GR));
  const darkL = Math.pow(minGL, ig) < 0.2 * maxL;
  const darkR = Math.pow(minGR, ig) < 0.2 * maxR;
  let ambG = null;
  if (o.amb) {
    const gA = o.amb.gamma || gamma0; // AMB reports aL/aR as G^(1/est.gamma) of the board at that time
    ambG = { L: o.amb.GL ?? Math.pow(o.amb.aL, gA), R: o.amb.GR ?? Math.pow(o.amb.aR, gA) };
  }
  const ambSource = ambG ? 'AMB' : darkL && darkR ? 'sweep' : 'partial';
  if (!ambG) ambG = { L: darkL ? 0.97 * minGL : 0, R: darkR ? 0.97 * minGR : 0 };
  // lamp-only brightness decides which points are "well lit" (o.legacyMask = the first version's rule, kept only
  // so the tests can show why it was wrong)
  const lamp = o.legacyMask ? E.map((e) => ({ L: e.L, R: e.R })) : E.map((e) => ({ L: e.L - Math.pow(ambG.L, ig), R: e.R - Math.pow(ambG.R, ig) }));
  const pkL = Math.max(...lamp.map((x) => x.L));
  const pkR = Math.max(...lamp.map((x) => x.R));
  const frac = o.frac ?? 0.3;
  const useL = lamp.map((x) => x.L >= frac * pkL);
  const useR = lamp.map((x) => x.R >= frac * pkR);
  const nUse = useL.filter(Boolean).length + useR.filter(Boolean).length;
  if (useL.filter(Boolean).length < 3 || useR.filter(Boolean).length < 3) throw new Error('ช่วงมุมแคบเกินไป: ต้องกวาดให้แต่ละ LDR ผ่านจุดสว่างสุดของมัน');
  // start at the angle where the two (peak-normalised) channels are brightest together
  const Sn = lamp.map((x) => x.L / pkL + x.R / pkR);
  let imax = 0;
  Sn.forEach((s, i) => { if (s > Sn[imax]) imax = i; });

  const fitG = o.fitGamma ?? ambSource === 'AMB';
  const gRatio = o.gRatio > 0 ? o.gRatio : null;
  const sameQ = o.sameQ ?? !!gRatio;
  const prior = 0.05; // residual per 1.0 of gamma away from the datasheet value (weak: data wins when informative)
  //              phi  alpha qL   qR   lnAL lnAR aL aR gL   gR
  const lo = [-400, -85, 0.3, 0.3, -30, -30, 0, 0, 0.3, 0.3];
  const hi = [400, 85, 6, 6, 30, 30, 1e6, 1e6, 1.2, 1.2];
  // with one q the right LDR's gamma must stay free (it carries the difference between the two products);
  // a measured ratio ties it to the left one instead
  const free = [true, true, !!o.fitQ, !!o.fitQ && !sameQ, true, true, false, false, fitG, !gRatio && (fitG || sameQ)];
  const tie = (P) => { if (sameQ) P.qR = P.qL; if (gRatio) P.gR = NS.clamp(P.gL * gRatio, 0.3, 1.2); return P; };
  const withAmb = (P) => { P.aL = ambG.L > 0 ? Math.pow(ambG.L, 1 / P.gL) : 0; P.aR = ambG.R > 0 ? Math.pow(ambG.R, 1 / P.gR) : 0; return P; };
  const resid = (v) => {
    const P = withAmb(tie(unpack(v)));
    const out = [];
    good.forEach((p, i) => {
      if (!useL[i] && !useR[i]) return;
      const m = NS.fit.model(P, p.ang);
      if (useL[i]) out.push(Math.log(p.GL) - Math.log(m.GL));
      if (useR[i]) out.push(Math.log(p.GR) - Math.log(m.GR));
    });
    if (fitG) out.push((P.gL - gamma0) * prior, (P.gR - gamma0) * prior);
    else if (sameQ && !gRatio) out.push((P.gR - gamma0) * prior * 0.2); // only keeps gR finite if the data is flat
    return out;
  };

  const a0 = Math.abs(o.alpha0 || 30);
  const alphaStarts = [a0, -a0, 20, -20, 45, -45];
  let best = null;
  for (const al of alphaStarts) {
    const P0 = {
      phi: good[imax].ang, alpha: al, qL: 1, qR: 1, lnAL: Math.log(Math.max(pkL, 1e-9)), lnAR: Math.log(Math.max(pkR, 1e-9)),
      aL: 0, aR: 0, gL: gamma0, gR: gamma0,
    };
    const r = NS.fit.lm(resid, pack(P0), { lo, hi, free, maxIter: 400 });
    if (!best || r.cost < best.cost) best = r;
  }
  const P = withAmb(tie(unpack(best.p)));
  P.gamma = P.gL; // estimator: est.gamma = left LDR, est.gammaR = right LDR
  P.gammaR = P.gR;
  return { P, rms: best.rms, iters: best.iters, n: good.length, nUse, span, ambSource, sameQ, gRatio };
};

// gammaR / gammaL from two lamp brightnesses at ONE fixed pose (paper over the lamp, nothing else moved):
// the lamp-only light (G^(1/gamma) minus the room light) must change by the same factor in both channels.
// lvl1, lvl2 = {GL, GR} conductances at the two brightnesses; amb = {GL, GR} with the lamp off (or null in a
// dark room); gammaL = the left LDR's gamma (any sensible value: the ratio barely depends on it).
// Returns {ratio, gammaR, factor} or throws with the reason in Thai.
NS.fit.gammaRatio = (lvl1, lvl2, amb, gammaL = 0.6) => {
  const aL = amb ? amb.GL : 0;
  const aR = amb ? amb.GR : 0;
  const lampPart = (G, Ga, g) => Math.pow(G, 1 / g) - (Ga > 0 ? Math.pow(Ga, 1 / g) : 0);
  const fL = lampPart(lvl1.GL, aL, gammaL) / lampPart(lvl2.GL, aL, gammaL);
  if (!(fL > 0) || !isFinite(fL)) throw new Error('ค่าระดับแสงไม่ถูกต้อง (ต้องเห็นหลอดทั้งสองระดับ และระดับ 2 ต้องไม่มืดเท่าตอนปิดหลอด)');
  // probe: dimming only 1.4x left the zero moving by up to 2.4 deg, 2.5x kept it within 0.4 deg
  if (Math.abs(Math.log(fL)) < Math.log(2)) throw new Error(`แสงสองระดับต่างกันแค่ ${fL.toFixed(2)} เท่า ต้องอย่างน้อย 2 เท่า: บังหลอดด้วยกระดาษเพิ่มอีกชั้นแล้ววัดระดับ 2 ใหม่`);
  // find gammaR so that the right channel sees the same brightness factor (bisection, monotonic in gammaR)
  const fR = (g) => lampPart(lvl1.GR, aR, g) / lampPart(lvl2.GR, aR, g);
  let lo = 0.2;
  let hi = 1.5;
  const sgn = (g) => Math.log(fR(g)) - Math.log(fL);
  if (!(sgn(lo) * sgn(hi) <= 0)) throw new Error('หาค่า γ ขวาที่ทำให้สองช่องตรงกันไม่ได้ (ตรวจว่าตัวดาวเทียมไม่ขยับระหว่างวัด และไม่มีช่องไหน ADC ตัน)');
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (sgn(lo) * sgn(m) <= 0) hi = m; else lo = m;
  }
  const gammaR = (lo + hi) / 2;
  return { ratio: gammaR / gammaL, gammaR, factor: fL };
};

// model params -> estimator params
NS.fit.gain = (P) => Math.exp(P.lnAR / P.qR - P.lnAL / P.qL);
NS.fit.toEst = (P, extra = {}) => ({
  gamma: P.gL ?? P.gamma, gammaR: P.gR ?? P.gamma, qL: P.qL, qR: P.qR, alpha: P.alpha, g: NS.fit.gain(P), aL: P.aL, aR: P.aR, th0: 0,
  lutOn: 1, lut: null, minS: extra.minS ?? 0.05, vcc: extra.vcc ?? 3300, topo: extra.topo ?? 0,
});

// Which calibration points are inside the usable range: both LDRs clearly see the lamp
// (each channel above `frac` of its own peak after removing room light).
NS.fit.usable = (pts, est, frac = 0.12) => {
  const e = pts.map((p) => NS.est.estimate(p.GL, p.GR, { ...est, lut: null, lutOn: 0, dmax: 1 }));
  const mL = Math.max(...e.map((x) => x.eL));
  const mR = Math.max(...e.map((x) => x.eR));
  return e.map((x) => x.eL >= frac * mL && x.eR >= frac * mR && x.valid);
};

// pool-adjacent-violators: make y non-decreasing (x already sorted)
const isotonic = (y) => {
  const blocks = y.map((v) => ({ s: v, n: 1 }));
  for (let i = 0; i < blocks.length - 1;) {
    if (blocks[i].s / blocks[i].n > blocks[i + 1].s / blocks[i + 1].n) {
      blocks[i].s += blocks[i + 1].s; blocks[i].n += blocks[i + 1].n; blocks.splice(i + 1, 1);
      if (i > 0) i--;
    } else i++;
  }
  return blocks.flatMap((b) => new Array(b.n).fill(b.s / b.n));
};

// Residual lookup table on a uniform grid of the raw (pre-LUT) estimate.
// Built from the monotonic raw -> true-angle mapping through the calibration points, so it stays exact
// even where the housing makes the response steep.
NS.fit.buildLUT = (pts, est, phi, o = {}) => {
  const dx = o.dx || 1;
  const use = NS.fit.usable(pts, est, o.frac);
  const noLut = { ...est, lut: null, lutOn: 0, dmax: 1 };
  const pairs = pts.filter((_, i) => use[i]).map((p) => ({ raw: NS.est.estimate(p.GL, p.GR, noLut).raw, truth: phi - p.ang }));
  if (pairs.length < 3) return null;
  const sign = Math.sign(NS.mean(pairs.map((q) => q.raw * q.truth))) || 1; // raw normally increases with truth
  pairs.sort((a, b) => a.raw - b.raw);
  const iso = isotonic(pairs.map((q) => q.truth * sign)).map((v) => v * sign);
  const xs = pairs.map((q) => q.raw);
  const x0 = Math.ceil(xs[0] / dx) * dx;
  const x1 = Math.floor(xs[xs.length - 1] / dx) * dx;
  const v = [];
  let j = 0;
  for (let x = x0; x <= x1 + 1e-9; x += dx) {
    while (j < xs.length - 2 && xs[j + 1] < x) j++;
    const f = xs[j + 1] === xs[j] ? 0 : (x - xs[j]) / (xs[j + 1] - xs[j]);
    const truth = iso[j] + NS.clamp(f, 0, 1) * (iso[j + 1] - iso[j]);
    v.push(Math.round((truth - (x + (est.th0 || 0))) * 1000) / 1000);
  }
  return { x0: +x0.toFixed(3), dx, v };
};

// the exact command list that loads a calibration into the board (tool, tests and docs all use this one)
NS.fit.pushLines = (e) => {
  const L = [
    `SET est.alpha ${e.alpha.toFixed(3)}`, `SET est.gamma ${e.gamma.toFixed(3)}`, `SET est.gammaR ${(e.gammaR || 0).toFixed(3)}`,
    `SET est.qL ${e.qL.toFixed(4)}`, `SET est.qR ${e.qR.toFixed(4)}`,
    `SET est.g ${e.g.toPrecision(6)}`, `SET est.aL ${e.aL.toPrecision(6)}`, `SET est.aR ${e.aR.toPrecision(6)}`,
    `SET est.minS ${e.minS}`, `SET est.dmax ${e.dmax ?? 0.95}`, 'SET est.th0 0', 'SET est.lut 1',
  ];
  if (e.lut) L.push(`CAL LUT ${e.lut.x0} ${e.lut.dx} ${e.lut.v.join(',')}`);
  L.push('SAVE');
  return L;
};

// usable angle range and the |D| limit that marks it (firmware flags readings beyond it as "edge")
NS.fit.range = (pts, est, phi, frac) => {
  const use = NS.fit.usable(pts, est, frac);
  const noLut = { ...est, lut: null, lutOn: 0, dmax: 1 };
  const inside = pts.filter((_, i) => use[i]);
  if (!inside.length) return null;
  const th = inside.map((p) => phi - p.ang);
  const dm = Math.max(...inside.map((p) => Math.abs(NS.est.estimate(p.GL, p.GR, noLut).D)));
  return { lo: Math.min(...th), hi: Math.max(...th), dmax: Math.min(0.99, +(dm * 1.02).toFixed(4)) };
};

NS.fit.metrics = (errs) => {
  const a = errs.filter(NS.isNum);
  if (!a.length) return { n: 0, mae: NaN, rms: NaN, max: NaN, mean: NaN };
  return {
    n: a.length,
    mae: NS.mean(a.map(Math.abs)),
    rms: Math.sqrt(NS.mean(a.map((x) => x * x))),
    max: Math.max(...a.map(Math.abs)),
    mean: NS.mean(a),
  };
};

// angle errors of an estimator over data with known lamp direction phi
NS.fit.errors = (pts, est, phi) => pts.map((p) => {
  const e = NS.est.estimate(p.GL, p.GR, est);
  const truth = phi - p.ang;
  return { ang: p.ang, truth, est: e.theta, err: e.valid && !e.edge ? e.theta - truth : NaN, D: e.D };
});

const linfit = (x, y) => { // y = a*x + b
  const n = x.length;
  const mx = NS.mean(x);
  const my = NS.mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const a = sxx ? sxy / sxx : 0;
  return { a, b: my - a * mx };
};

// Compare simple methods vs ours on the same points (uses only points where ours is valid)
NS.fit.compare = (pts, est, phi) => {
  const rows = [];
  const use = NS.fit.usable(pts, est);
  const ok = pts.filter((_, i) => use[i]);
  if (ok.length < 4) return rows;
  const truth = ok.map((p) => phi - p.ang);
  const dv = ok.map((p) => p.mvL - p.mvR);
  const l1 = linfit(dv, truth);
  rows.push({ name: 'เส้นตรงจากผลต่าง mV ดิบ', m: NS.fit.metrics(ok.map((p, i) => l1.a * dv[i] + l1.b - truth[i])) });
  const draw = ok.map((p) => Math.atan((p.mvL - p.mvR) / (p.mvL + p.mvR)) * NS.RAD);
  const l2 = linfit(draw, truth);
  rows.push({ name: 'atan(D ดิบ) × k', m: NS.fit.metrics(ok.map((p, i) => l2.a * draw[i] + l2.b - truth[i])) });
  const noLut = { ...est, lut: null, lutOn: 0 };
  rows.push({ name: 'โมเดลฟิสิกส์ (ของเรา)', m: NS.fit.metrics(NS.fit.errors(ok, noLut, phi).map((e) => e.err)) });
  if (est.lut) rows.push({ name: 'โมเดลฟิสิกส์ + LUT (ของเรา)', m: NS.fit.metrics(NS.fit.errors(ok, est, phi).map((e) => e.err)) });
  return rows;
};

// sweep points -> CSV and back
NS.fit.toCSV = (pts) => ['ang,mvL,mvR,GL,GR', ...pts.map((p) => [p.ang, p.mvL, p.mvR, p.GL, p.GR].map((v) => (NS.isNum(v) ? +v.toFixed(6) : '')).join(','))].join('\n');
NS.fit.fromCSV = (text, vcc, topo) => {
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(',').map((s) => s.trim());
  const ix = (k) => head.indexOf(k);
  return lines.map((l) => {
    const c = l.split(',').map(Number);
    const mvL = c[ix('mvL')];
    const mvR = c[ix('mvR')];
    return { ang: c[ix('ang')], mvL, mvR, GL: NS.est.toG(mvL, vcc, topo), GR: NS.est.toG(mvR, vcc, topo) };
  }).filter((p) => NS.isNum(p.ang) && NS.isNum(p.mvL) && NS.isNum(p.mvR));
};
