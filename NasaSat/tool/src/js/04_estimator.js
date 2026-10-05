'use strict';
// ===== sun-angle estimator (the same chain the firmware runs) =====
// mV --(divider)--> G = relative conductance --(^1/gamma of that LDR, - ambient)--> E (∝ light)
//   --(^1/q)--> e ∝ cos(incidence) --> D = (eL-eR)/(eL+eR) = tan(theta)*tan(alpha)
//   --> theta = atan(D / tan(alpha)) + theta0 + LUT(raw)
NS.est = {};

NS.est.defaults = () => ({ gamma: 0.6, gammaR: 0, qL: 1, qR: 1, alpha: 30, g: 1, aL: 0, aR: 0, th0: 0, lutOn: 1, lut: null, minS: 0.05, vcc: 3300, topo: 0 });
// gamma of the right LDR (est.gammaR); 0 = same as the left one (est.gamma)
NS.est.gR = (p) => (p.gammaR > 0 ? p.gammaR : p.gamma);

// G = Rfixed / R_LDR (unitless). Needs only the divider supply and which side the LDR is on.
NS.est.toG = (mv, vcc, topo) => {
  const v = NS.clamp(mv, 1, vcc - 1);
  return topo === 1 ? (vcc - v) / v : v / (vcc - v);
};

NS.est.lutInterp = (lut, x) => {
  if (!lut || !lut.v || !lut.v.length) return 0;
  const n = lut.v.length;
  const u = (x - lut.x0) / lut.dx;
  if (u <= 0) return lut.v[0];
  if (u >= n - 1) return lut.v[n - 1];
  const i = Math.floor(u);
  const f = u - i;
  return lut.v[i] * (1 - f) + lut.v[i + 1] * f;
};

// e-channel before the gain match (used by BAL to compute g)
NS.est.eChannel = (G, gamma, a, q) => {
  let e = Math.pow(Math.max(G, 1e-9), 1 / gamma) - a;
  if (e < 0) e = 0;
  return q !== 1 ? Math.pow(e, 1 / q) : e;
};

NS.est.estimate = (GL, GR, p) => {
  // each LDR with its own gamma and housing shape q; the gain match g is applied after the roots
  // so that lamp brightness cancels in D
  const eL = NS.est.eChannel(GL, p.gamma, p.aL, p.qL ?? p.q ?? 1);
  const eR = NS.est.eChannel(GR, NS.est.gR(p), p.aR, p.qR ?? p.q ?? 1) / (p.g || 1);
  const S = eL + eR;
  const D = S > 1e-12 ? (eL - eR) / S : 0;
  let ta = Math.tan(p.alpha * NS.DEG);
  if (Math.abs(ta) < 1e-6) ta = ta < 0 ? -1e-6 : 1e-6;
  const raw = Math.atan(D / ta) * NS.RAD;
  let theta = raw + (p.th0 || 0);
  if (p.lutOn && p.lut) theta += NS.est.lutInterp(p.lut, raw);
  return { eL, eR, S, D, raw, theta, valid: S >= p.minS, edge: Math.abs(D) > (p.dmax ?? 0.95) };
};

// a clipped ADC reading has no direction information: never steer or lock on it
NS.est.SAT_HI = 3050;
NS.est.SAT_LO = 60;
NS.est.clipped = (mv, topo) => (topo === 1 ? mv <= NS.est.SAT_LO : mv >= NS.est.SAT_HI);

// Convenience: straight from millivolts
NS.est.fromMv = (mvL, mvR, p) => NS.est.estimate(NS.est.toG(mvL, p.vcc, p.topo), NS.est.toG(mvR, p.vcc, p.topo), p);

// Build estimator params from a board config map (cfg values keyed by name)
NS.est.fromCfg = (get, lut) => ({
  gamma: get('est.gamma', 0.6), gammaR: get('est.gammaR', 0), qL: get('est.qL', 1), qR: get('est.qR', 1), alpha: get('est.alpha', 30), g: get('est.g', 1),
  aL: get('est.aL', 0), aR: get('est.aR', 0), th0: get('est.th0', 0), lutOn: get('est.lut', 1),
  lut: lut || null, minS: get('est.minS', 0.05), dmax: get('est.dmax', 0.95), vcc: get('sen.vcc', 3300), topo: get('sen.topo', 0),
});
