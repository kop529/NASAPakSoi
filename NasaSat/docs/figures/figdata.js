// Data for the theory figures, computed with the SAME JavaScript the web tool uses (fit, estimator).
// Output: figdata.json (read by make_figures.py). Usage: node docs/figures/figdata.js
'use strict';
const fs = require('fs');
const path = require('path');

const js = path.join(__dirname, '..', '..', 'tool', 'src', 'js');
for (const f of ['01_util.js', '02_protocol.js', '04_estimator.js', '05_fit.js', '06_cfgdefs.js']) require(path.join(js, f));
const NS = globalThis.NS;

// deterministic noise
let seed = 20261009;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { const u = Math.max(rnd(), 1e-12); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// the same hidden "truth" as the simulators: two LDRs that are NOT identical, a housing that cuts the view at 78 deg
const T = { alphaL: 31.0, alphaR: 30.6, q: 1.35, fov: 78, gL: 0.62, gR: 0.57, r10L: 14000, r10R: 17500, rf: 10000, vcc: 3300 };
const irr = (inc, K, amb) => {
  const c = Math.cos(inc * NS.DEG);
  const vign = NS.clamp((T.fov - Math.abs(inc)) / 12, 0, 1);
  return K * Math.pow(Math.max(c, 0), T.q) * vign + amb + 0.002;
};
const mv = (E, r10, g, noise) => NS.clamp(T.vcc * T.rf / (T.rf + r10 * Math.pow(E / 0.1, -g)) + noise * gauss(), 0, 3100);
const sample = (theta, K = 1, amb = 0.03, noise = 0) => {
  const mvL = mv(irr(theta - T.alphaL, K, amb), T.r10L, T.gL, noise);
  const mvR = mv(irr(theta + T.alphaR, K, amb), T.r10R, T.gR, noise);
  return { mvL, mvR, GL: NS.est.toG(mvL, T.vcc, 0), GR: NS.est.toG(mvR, T.vcc, 0) };
};
const ambOf = (amb) => { const d = sample(0, 0, amb, 0); return { aL: Math.pow(d.GL, 1 / 0.6), aR: Math.pow(d.GR, 1 / 0.6), gamma: 0.6, GL: d.GL, GR: d.GR }; };

// full calibration exactly as the tool does it (AMB -> sweep -> fit -> minS -> range -> LUT)
const calibrate = (amb, o = {}) => {
  const phi = 25;
  const pts = [];
  for (let ang = -60; ang <= 60; ang += 5) pts.push({ ang, ...sample(phi - ang, 1, amb, o.noise ?? 2) });
  const fit = NS.fit.fitPhysical(pts, { gamma: 0.6, alpha0: 30, fitQ: true, amb: o.noAmb ? null : ambOf(amb), fitGamma: o.fitGamma, legacyMask: o.legacyMask });
  const est = NS.fit.toEst(fit.P);
  const near = pts.filter((p) => Math.abs(fit.P.phi - p.ang) < 12).map((p) => NS.est.estimate(p.GL, p.GR, { ...est, lutOn: 0 }).S);
  est.minS = +((near.length ? NS.median(near) : 1) * 0.15).toPrecision(3);
  const rng = NS.fit.range(pts, est, fit.P.phi);
  if (rng) est.dmax = rng.dmax;
  est.lut = NS.fit.buildLUT(pts, est, fit.P.phi, { dx: 1 });
  return { phi, pts, fit, est, rng };
};
const thetaErr = (est, th, K, amb) => { const s = sample(th, K, amb, 0); return NS.est.estimate(s.GL, s.GR, est).theta - th; };

const out = {};

// ---- 1. calibration sweep, model, errors (normal room: ambient 3 % of the lamp)
{
  const c = calibrate(0.03);
  const P = c.fit.P;
  const grid = [];
  for (let a = -60; a <= 60; a += 0.5) grid.push(a);
  out.cal = {
    phi_true: c.phi,
    P: { phi: P.phi, alpha: P.alpha, qL: P.qL, qR: P.qR, gL: P.gL, gR: P.gR, aL: P.aL, aR: P.aR, g: NS.fit.gain(P) },
    rms: c.fit.rms,
    range: c.rng,
    pts: c.pts.map((p) => [p.ang, p.GL, p.GR]),
    model: grid.map((a) => { const m = NS.fit.model(P, a); return [a, m.GL, m.GR]; }),
    lut: c.est.lut,
    errNoLut: c.pts.map((p) => { const e = NS.est.estimate(p.GL, p.GR, { ...c.est, lut: null, lutOn: 0 }); return [P.phi - p.ang, e.theta - (P.phi - p.ang), e.valid && !e.edge]; }),
    errLut: c.pts.map((p) => { const e = NS.est.estimate(p.GL, p.GR, c.est); return [P.phi - p.ang, e.theta - (P.phi - p.ang), e.valid && !e.edge]; }),
    compare: NS.fit.compare(c.pts, c.est, P.phi).map((x) => ({ name: x.name, mae: x.m.mae, max: x.m.max })),
  };
  // validation against the TRUE angle (a different grid, noise-free) inside the usable range
  const val = [];
  for (let th = c.rng.lo + 2; th <= c.rng.hi - 2; th += 1) val.push([th, thetaErr(c.est, th, 1, 0.03)]);
  out.cal.valTrue = val;
  out.cal.valTrueMetrics = NS.fit.metrics(val.map((v) => v[1]));
  // what the tool's own validation reports (fitted phi used as truth) vs truth: constant offset = the "absolute zero" problem
  out.cal.phiOffset = P.phi - c.phi;
  out.est = c.est;

  // ---- 2. brightness robustness: ours vs raw atan(D)*k fitted at K = 1
  const ok = c.pts.filter((p) => Math.abs(c.phi - p.ang) < 45);
  const x = ok.map((p) => Math.atan((p.mvL - p.mvR) / (p.mvL + p.mvR)) * NS.RAD);
  const y = ok.map((p) => c.phi - p.ang);
  const mx = NS.mean(x); const my = NS.mean(y);
  let sxy = 0; let sxx = 0;
  x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) ** 2; });
  const ka = sxy / sxx; const kb = my - ka * mx;
  const rawTheta = (s) => ka * Math.atan((s.mvL - s.mvR) / (s.mvL + s.mvR)) * NS.RAD + kb;
  out.bright = [];
  for (const K of [0.5, 1, 2]) {
    const row = { K, th: [], ours: [], raw: [], rawD: [] };
    for (let th = -35; th <= 35; th += 1) {
      const s = sample(th, K, 0.03, 0);
      row.th.push(th);
      row.ours.push(NS.est.estimate(s.GL, s.GR, c.est).theta);
      row.raw.push(rawTheta(s));
      row.rawD.push((s.mvL - s.mvR) / (s.mvL + s.mvR));
    }
    out.bright.push(row);
  }
  out.brightMae = [0.5, 2].map((K) => {
    const eo = []; const er = [];
    for (let th = -35; th <= 35; th += 5) { const s = sample(th, K, 0.03, 0); eo.push(NS.est.estimate(s.GL, s.GR, c.est).theta - th); er.push(rawTheta(s) - th); }
    return { K, ours: NS.fit.metrics(eo).mae, raw: NS.fit.metrics(er).mae };
  });

  // ---- 3. noise -> angle: 1 mV on one channel at the null
  const s0 = sample(0, 1, 0.03, 0);
  const th0 = NS.est.estimate(s0.GL, s0.GR, c.est).theta;
  const s1 = { ...s0, GL: NS.est.toG(s0.mvL + 1, T.vcc, 0) };
  out.noise = { mvL: s0.mvL, mvR: s0.mvR, dThetaPerMv: NS.est.estimate(s1.GL, s1.GR, c.est).theta - th0 };
}

// ---- 4. room light: shared gamma vs one gamma per LDR (both with AMB), and no AMB at all
out.ambient = [];
for (const amb of [0.03, 0.1, 0.3]) {
  for (const mode of ['legacy', 'shared', 'perLdr', 'noAmb']) {
    const c = calibrate(amb, { noise: 0, fitGamma: mode === 'shared' ? false : undefined, noAmb: mode === 'noAmb', legacyMask: mode === 'legacy' });
    const Ks = [0.4, 0.5, 0.7, 1, 1.4, 1.8, 2.2];
    const mae = Ks.map((K) => {
      const e = [];
      for (let th = -30; th <= 30; th += 5) e.push(thetaErr(c.est, th, K, amb));
      return NS.fit.metrics(e).mae;
    });
    out.ambient.push({ amb, mode, Ks, mae, gL: c.fit.P.gL, gR: c.fit.P.gR });
  }
}

fs.writeFileSync(path.join(__dirname, 'figdata.json'), JSON.stringify(out, null, 1));
console.log('calibration: phi', out.cal.P.phi.toFixed(3), 'alpha', out.cal.P.alpha.toFixed(2), 'gamma L/R', out.cal.P.gL.toFixed(3), out.cal.P.gR.toFixed(3), 'rms', out.cal.rms.toFixed(4));
console.log('validation vs truth: MAE', out.cal.valTrueMetrics.mae.toFixed(3), 'mean', out.cal.valTrueMetrics.mean.toFixed(3), 'max', out.cal.valTrueMetrics.max.toFixed(3), '| phi offset', out.cal.phiOffset.toFixed(3));
console.log('compare:', out.cal.compare.map((r) => `${r.name}: ${r.mae.toFixed(3)}`).join(' | '));
console.log('brightness MAE:', JSON.stringify(out.brightMae));
console.log('noise: dtheta per mV =', out.noise.dThetaPerMv.toFixed(4), 'deg at mv', out.noise.mvL.toFixed(0), out.noise.mvR.toFixed(0));
for (const a of out.ambient) console.log(`ambient ${a.amb} ${a.mode.padEnd(6)} gamma ${a.gL.toFixed(3)}/${a.gR.toFixed(3)} MAE@K`, a.Ks.map((K, i) => `${K}:${a.mae[i].toFixed(2)}`).join(' '));
