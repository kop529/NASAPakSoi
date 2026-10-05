// Host test: compares the firmware sun model (Team_SunModel.h, compiled with g++) with the web tool's
// NS.est.fromMv on 2000 random cases plus edge cases. Run inside WSL:  bash SunSeek/host_test/run.sh
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const js = path.join(__dirname, '..', '..', 'NasaSat', 'tool', 'src', 'js');
require(path.join(js, '01_util.js'));
require(path.join(js, '04_estimator.js'));
const NS = globalThis.NS;

let seed = 4242;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a, b) => a + (b - a) * rnd();
const lut = { x0: -40, dx: 10, v: [1.5, 1.0, 0.4, 0.0, -0.3, -0.2, 0.25, 0.8, 1.2] };

const cases = [];
for (let i = 0; i < 2000; i++) {
  cases.push({
    mvL: pick(-50, 3400), mvR: pick(-50, 3400),
    gamma: pick(0.3, 1.2), gammaR: rnd() < 0.5 ? 0 : pick(0.3, 1.2),
    qL: rnd() < 0.3 ? 1 : pick(0.5, 3), qR: rnd() < 0.3 ? 1 : pick(0.5, 3),
    alpha: pick(5, 80), g: pick(0.5, 2), aL: rnd() < 0.3 ? 0 : pick(0, 2), aR: rnd() < 0.3 ? 0 : pick(0, 2),
    th0: pick(-3, 3), minS: pick(0, 0.5), dmax: pick(0.5, 1), vcc: 3300, topo: rnd() < 0.5 ? 0 : 1, lutOn: rnd() < 0.5 ? 1 : 0,
  });
}
// edge cases: equal light, clipped ends, dark, LUT ends
for (const [mvL, mvR] of [[1650, 1650], [0, 0], [3300, 3300], [3299, 1], [1, 3299], [5, 3000], [3000, 5]]) {
  cases.push({ mvL, mvR, gamma: 0.6, gammaR: 0, qL: 1, qR: 1, alpha: 30, g: 1, aL: 0, aR: 0, th0: 0, minS: 0.05, dmax: 0.95, vcc: 3300, topo: 0, lutOn: 1 });
}

const input = cases.map((c) => [c.mvL, c.mvR, c.gamma, c.gammaR, c.qL, c.qR, c.alpha, c.g, c.aL, c.aR, c.th0, c.minS, c.dmax, c.vcc, c.topo, c.lutOn].join(' ')).join('\n') + '\n';
const out = execFileSync(path.join(__dirname, 'build', 'sunmodel_parity'), { input, encoding: 'utf8' }).trim().split('\n');

let worst = 0, bad = 0;
cases.forEach((c, i) => {
  const e = NS.est.fromMv(c.mvL, c.mvR, { ...c, lut: c.lutOn ? lut : null });
  const [theta, raw, S, D, valid, edge] = out[i].split(' ').map(Number);
  const d = Math.max(Math.abs(theta - e.theta), Math.abs(raw - e.raw), Math.abs(D - e.D), Math.abs(S - e.S) / Math.max(1, Math.abs(e.S)));
  worst = Math.max(worst, d);
  // the firmware stores LUT values as float (0.4f = 0.40000000596...), so allow 1e-6 deg; any real
  // porting mistake shows up as degrees, not micro-degrees
  if (d > 1e-6 || !!valid !== e.valid || !!edge !== e.edge) {
    bad++;
    if (bad <= 5) console.log('MISMATCH', JSON.stringify(c), out[i], JSON.stringify(e));
  }
});
console.log(`sun model parity: ${cases.length} cases, ${bad} mismatches, worst difference ${worst.toExponential(2)}`);
process.exitCode = bad ? 1 : 0;
