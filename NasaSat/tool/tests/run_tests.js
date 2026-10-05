// Node tests for the non-DOM parts of NasaSat Lab.  Usage: node tests/run_tests.js
'use strict';
const path = require('path');
const js = path.join(__dirname, '..', 'src', 'js');
for (const f of ['01_util.js', '02_protocol.js', '03_serial.js', '04_estimator.js', '05_cam.js', '05_fit.js', '06_cfgdefs.js', '06b_rules.js', '07_sim.js']) require(path.join(js, f));
const NS = globalThis.NS;

let fails = 0;
let passes = 0;
const check = (name, cond, info = '') => {
  if (cond) { passes++; console.log(`  ok   ${name} ${info}`); } else { fails++; console.log(`  FAIL ${name} ${info}`); }
};

// deterministic noise (also makes the simulator repeatable)
let seed = 12345;
let simSeed = 987654;
Math.random = () => { simSeed = (simSeed * 1103515245 + 12345) & 0x7fffffff; return simSeed / 0x7fffffff; };
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { const u = Math.max(rnd(), 1e-12); const v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

console.log('protocol');
check('crc16 CCITT-FALSE "123456789" = 29B1', NS.crc16('123456789') === 0x29b1, NS.crc16('123456789').toString(16));
check('crc32 "123456789" = CBF43926', NS.crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
{
  const a = NS.parseLine('@12 OK est.alpha=31.2');
  check('parse OK with id', a.kind === 'ok' && a.id === 12 && a.text === 'est.alpha=31.2');
  const b = NS.parseLine('@3 ERR RANGE ctl.k 0.1..1.5');
  check('parse ERR', b.kind === 'err' && b.code === 'RANGE' && b.text === 'ctl.k 0.1..1.5');
  const c = NS.parseLine(NS.withCrc('T,1,2,3'));
  check('parse T with valid crc', c.kind === 't' && c.vals.length === 3);
  const d = NS.parseLine('T,1,2,3*0000');
  check('bad crc rejected', d.kind === 'bad');
  const e = NS.parseLine('J {"type":"raw","mv":[1,2]}');
  check('parse J', e.kind === 'j' && e.json.type === 'raw');
  const f = NS.parseLine('E M1 HOLD t=123 it=4');
  check('parse E', f.kind === 'e' && f.evt === 'M1' && f.args[0] === 'HOLD');
}

// ---- synthetic V-sensor identical in spirit to the simulator truth ----
const truth = { alphaL: 31.0, alphaR: 30.6, q: 1.35, gL: 0.62, gR: 0.57, r10L: 14000, r10R: 17500, rf: 10000, vcc: 3300, fov: 78 };
const irr = (inc, K, amb) => {
  const c = Math.cos(inc * NS.DEG);
  const vign = NS.clamp((truth.fov - Math.abs(inc)) / 12, 0, 1);
  return K * Math.pow(Math.max(c, 0), truth.q) * vign + amb + 0.002;
};
const mv = (E, r10, g, noise) => {
  const R = r10 * Math.pow(E / 0.1, -g);
  return NS.clamp(truth.vcc * truth.rf / (truth.rf + R) + noise * gauss(), 0, 3100);
};
const sample = (theta, K = 1, amb = 0.03, noise = 2) => {
  const mvL = mv(irr(theta - truth.alphaL, K, amb), truth.r10L, truth.gL, noise);
  const mvR = mv(irr(theta + truth.alphaR, K, amb), truth.r10R, truth.gR, noise);
  return { mvL, mvR, GL: NS.est.toG(mvL, 3300, 0), GR: NS.est.toG(mvR, 3300, 0) };
};

console.log('calibration fit (synthetic sweep, lamp at phi = 17 deg in actuator frame)');
const phi = 17;
const pts = [];
for (let ang = phi - 70; ang <= phi + 70; ang += 5) pts.push({ ang, ...sample(phi - ang) });
const r = NS.fit.fitPhysical(pts, { gamma: 0.6, alpha0: 30, fitQ: true });
check('fit converged', NS.isNum(r.rms) && r.rms < 0.05, `rms(log)=${r.rms.toFixed(4)} iters=${r.iters}`);
check('lamp direction recovered', Math.abs(r.P.phi - phi) < 0.5, `phi=${r.P.phi.toFixed(3)} (truth ${phi})`);
check('alpha plausible', Math.abs(Math.abs(r.P.alpha) - 30.8) < 4, `alpha=${r.P.alpha.toFixed(2)}`);
const est = NS.fit.toEst(r.P);
est.lut = NS.fit.buildLUT(pts, est, r.P.phi, { dx: 1 });
const val = [];
for (let ang = phi - 42.5; ang <= phi + 42.5; ang += 5) val.push({ ang, ...sample(phi - ang) });
const rng = NS.fit.range(pts, est, r.P.phi);
console.log(`     usable range ${rng.lo.toFixed(1)}..${rng.hi.toFixed(1)} deg, dmax ${rng.dmax}`);
est.dmax = rng.dmax;
const mNo = NS.fit.metrics(NS.fit.errors(val, { ...est, lut: null, lutOn: 0 }, phi).map((e) => e.err));
const mLut = NS.fit.metrics(NS.fit.errors(val, est, phi).map((e) => e.err));
console.log(`     validation (true phi): model MAE ${mNo.mae.toFixed(3)} max ${mNo.max.toFixed(3)} | +LUT MAE ${mLut.mae.toFixed(3)} max ${mLut.max.toFixed(3)} (n=${mLut.n})`);
check('validation MAE with LUT < 0.3 deg (usable range)', mLut.mae < 0.3, `${mLut.mae.toFixed(3)}`);
{ const s0 = sample(0, 1, 0.03, 0); const e0 = NS.est.estimate(s0.GL, s0.GR, est); check('pointing null accurate (|err| at true 0 < 0.3 deg, noise-free)', Math.abs(e0.theta) < 0.3, `est at true 0 = ${e0.theta.toFixed(3)}`); }

console.log('robustness: calibrate at lamp K=1, run at other brightness / room light');
const rows = NS.fit.compare(pts, est, r.P.phi);
for (const x of rows) console.log(`     same-data ${x.name.padEnd(28)} MAE ${x.m.mae.toFixed(3)} max ${x.m.max.toFixed(3)}`);
const l2 = (() => { // "atan(D raw) * k" baseline fitted at K = 1
  const ok = pts.filter((p) => Math.abs(phi - p.ang) < 45);
  const x = ok.map((p) => Math.atan((p.mvL - p.mvR) / (p.mvL + p.mvR)) * NS.RAD);
  const y = ok.map((p) => phi - p.ang);
  const mx = NS.mean(x); const my = NS.mean(y);
  let sxy = 0; let sxx = 0;
  x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sxx += (v - mx) ** 2; });
  const a = sxy / sxx; return { a, b: my - a * mx };
})();
for (const [K, amb] of [[0.5, 0.03], [2, 0.03], [1, 0.08]]) {
  const errsOurs = [];
  const errsRaw = [];
  for (let th = -40; th <= 40; th += 5) {
    const s = sample(th, K, amb, 1);
    errsOurs.push(NS.est.estimate(s.GL, s.GR, est).theta - th);
    errsRaw.push(l2.a * Math.atan((s.mvL - s.mvR) / (s.mvL + s.mvR)) * NS.RAD + l2.b - th);
  }
  const mo = NS.fit.metrics(errsOurs);
  const mr = NS.fit.metrics(errsRaw);
  console.log(`     K=${K} ambient=${amb}: ours MAE ${mo.mae.toFixed(3)} | raw atan(D)·k MAE ${mr.mae.toFixed(3)}`);
  if (amb === 0.03) check(`ours stays accurate when lamp brightness x${K}`, mo.mae < 1.0 && mo.mae < mr.mae, `${mo.mae.toFixed(3)} vs ${mr.mae.toFixed(3)}`);
  else check('room light changed, AMB NOT re-measured: degraded (documented) but still better than raw', mo.mae < 2.0 && mo.mae < mr.mae, `${mo.mae.toFixed(3)} vs ${mr.mae.toFixed(3)}`);
}
{ // lit room (room light 30 % of the lamp): the calibration points must be chosen by lamp light only
  const amb = 0.3;
  const ptsB = [];
  for (let ang = -60; ang <= 60; ang += 5) ptsB.push({ ang, ...sample(25 - ang, 1, amb, 0) });
  const dark = sample(0, 0, amb, 0);
  const ambB = { aL: Math.pow(dark.GL, 1 / 0.6), aR: Math.pow(dark.GR, 1 / 0.6), gamma: 0.6, GL: dark.GL, GR: dark.GR };
  const maeOf = (o) => {
    const r2 = NS.fit.fitPhysical(ptsB, { gamma: 0.6, alpha0: 30, fitQ: true, amb: ambB, ...o });
    const e2 = NS.fit.toEst(r2.P);
    e2.lut = NS.fit.buildLUT(ptsB, e2, r2.P.phi, { dx: 1 });
    const errs = [];
    for (let th = -30; th <= 30; th += 5) { const s = sample(th, 1, amb, 0); errs.push(NS.est.estimate(s.GL, s.GR, e2).theta - th); }
    return NS.fit.metrics(errs).mae;
  };
  const legacy = maeOf({ legacyMask: true });
  const now = maeOf({});
  check('lit room: counting room light as lamp light when picking fit points fails; lamp-only picking works', legacy > 3 && now < 0.5, `legacy MAE ${legacy.toFixed(2)} vs now ${now.toFixed(3)}`);
}
{ // procedure fix: re-run AMB (lamp off) after the room light changes
  const dark = sample(0, 0, 0.08, 0);
  const estAmb = { ...est, aL: Math.pow(dark.GL, 1 / est.gamma), aR: Math.pow(dark.GR, 1 / est.gamma) };
  const errs = [];
  for (let th = -40; th <= 40; th += 5) { const s = sample(th, 1, 0.08, 1); errs.push(NS.est.estimate(s.GL, s.GR, estAmb).theta - th); }
  const m = NS.fit.metrics(errs);
  check('room light changed + AMB re-measured -> accurate again (MAE < 0.4)', m.mae < 0.4, `MAE ${m.mae.toFixed(3)}`);
}

console.log('brightness invariance: gamma ratio from two lamp brightnesses (audit 30 Sep, F04)');
{
  // same synthetic sensor, but each LDR may sit in a differently shaped housing (qL, qR)
  const samp = (qL, qR) => (theta, K = 1, amb = 0.03, noise = 1) => {
    const irrQ = (inc, q) => { const c = Math.cos(inc * NS.DEG); return K * Math.pow(Math.max(c, 0), q) * NS.clamp((truth.fov - Math.abs(inc)) / 12, 0, 1) + amb + 0.002; };
    const mvL = mv(irrQ(theta - truth.alphaL, qL), truth.r10L, truth.gL, noise);
    const mvR = mv(irrQ(theta + truth.alphaR, qR), truth.r10R, truth.gR, noise);
    return { mvL, mvR, GL: NS.est.toG(mvL, 3300, 0), GR: NS.est.toG(mvR, 3300, 0) };
  };
  const s0 = samp(1.35, 1.35);
  const darkC = (sp, amb) => { const d = sp(0, 0, amb, 0); return { GL: d.GL, GR: d.GR }; };
  const g = NS.fit.gammaRatio(s0(0, 1, 0.03, 0), s0(0, 0.4, 0.03, 0), darkC(s0, 0.03), truth.gL);
  check('gammaRatio: noise-free readings give the true gammaR/gammaL', Math.abs(g.ratio - truth.gR / truth.gL) < 1e-3, `${g.ratio.toFixed(5)} vs ${(truth.gR / truth.gL).toFixed(5)}, lamp factor ${g.factor.toFixed(2)}`);
  let tooSmall = null;
  try { NS.fit.gammaRatio(s0(0, 1, 0.03, 0), s0(0, 0.7, 0.03, 0), darkC(s0, 0.03), 0.6); } catch (e) { tooSmall = e.message; }
  check('gammaRatio refuses a dimming smaller than 2x (probe: 1.4x left up to 2.4 deg)', !!tooSmall, tooSmall || 'accepted');
  // calibrate at K = 1 (sweep + AMB + two lamp levels), then find where the estimator reads zero at other K
  const zeroShift = (qL, qR, amb, useRatio) => {
    const sp = samp(qL, qR);
    const ptsQ = [];
    for (let a = -60; a <= 60; a += 5) ptsQ.push({ ang: a, ...sp(-a, 1, amb, 2) });
    const dk = sp(0, 0, amb, 1);
    const A = { aL: Math.pow(dk.GL, 1 / 0.6), aR: Math.pow(dk.GR, 1 / 0.6), gamma: 0.6, GL: dk.GL, GR: dk.GR };
    const o = { gamma: 0.6, alpha0: 30, fitQ: true, amb: A };
    let rr = NS.fit.fitPhysical(ptsQ, o);
    if (useRatio) {
      const l1 = sp(0, 1, amb, 1);
      const l2 = sp(0, 0.4, amb, 1);
      for (let it = 0; it < 3; it++) rr = NS.fit.fitPhysical(ptsQ, { ...o, gRatio: NS.fit.gammaRatio(l1, l2, { GL: dk.GL, GR: dk.GR }, rr.P.gL).ratio });
      if (rr.P.qL !== rr.P.qR) throw new Error('sameQ not applied');
    }
    const e = NS.fit.toEst(rr.P);
    e.lut = NS.fit.buildLUT(ptsQ, e, rr.P.phi, { dx: 1 });
    e.dmax = 1;
    const f = (s) => NS.est.estimate(s.GL, s.GR, e).theta;
    const z = f(sp(0, 1, amb, 0));
    const nullAt = (K) => { let lo = -15; let hi = 15; for (let i = 0; i < 50; i++) { const m2 = (lo + hi) / 2; if (f(sp(m2, K, amb, 0)) - z > 0) hi = m2; else lo = m2; } return (lo + hi) / 2; };
    return Math.max(Math.abs(nullAt(0.5)), Math.abs(nullAt(2)));
  };
  for (const amb of [0.03, 0.3]) {
    const free = zeroShift(1.25, 1.45, amb, false);
    const ratio = zeroShift(1.25, 1.45, amb, true);
    check(`uneven housings (q 1.25/1.45), room light ${amb}: lamp x0.5/x2 moves the zero ${free.toFixed(2)} deg without the ratio, <= 0.4 deg with it`, free > 1.5 && ratio <= 0.4, `${free.toFixed(2)} -> ${ratio.toFixed(2)} deg`);
  }
  // the room light changes after a gamma-ratio calibration (Sonnet audit F07): leaving it alone is fine; re-measuring
  // only AMB was up to 3 deg worse with the old fit, so the playbook says: check the zero, redo CAL TH0 if needed
  {
    const sp = samp(1.25, 1.45);
    const ptsQ = [];
    for (let a = -60; a <= 60; a += 5) ptsQ.push({ ang: a, ...sp(-a, 1, 0.03, 2) });
    const dk = sp(0, 0, 0.03, 1);
    const o = { gamma: 0.6, alpha0: 30, fitQ: true, amb: { aL: Math.pow(dk.GL, 1 / 0.6), aR: Math.pow(dk.GR, 1 / 0.6), gamma: 0.6, GL: dk.GL, GR: dk.GR } };
    let rr = NS.fit.fitPhysical(ptsQ, o);
    for (let it = 0; it < 3; it++) rr = NS.fit.fitPhysical(ptsQ, { ...o, gRatio: NS.fit.gammaRatio(sp(0, 1, 0.03, 1), sp(0, 0.4, 0.03, 1), { GL: dk.GL, GR: dk.GR }, rr.P.gL).ratio });
    const e = NS.fit.toEst(rr.P);
    e.lut = NS.fit.buildLUT(ptsQ, e, rr.P.phi, { dx: 1 });
    e.dmax = 1;
    const f = (s) => NS.est.estimate(s.GL, s.GR, e).theta;
    const z = f(sp(0, 1, 0.03, 0));
    const nullAt = (amb) => { let lo = -15; let hi = 15; for (let i = 0; i < 50; i++) { const m2 = (lo + hi) / 2; if (f(sp(m2, 1, amb, 0)) - z > 0) hi = m2; else lo = m2; } return (lo + hi) / 2; };
    const moved = Math.max(Math.abs(nullAt(0.15)), Math.abs(nullAt(0.3)));
    check('gamma-ratio calibration, room light 3% -> 15% / 30% without recalibrating: zero moves <= 0.4 deg', moved <= 0.4, `${moved.toFixed(2)} deg`);
  }
}

console.log('image assembler (lost / damaged / stalled chunks)');
{
  const got = [];
  const req = [];
  const asm = new NS.ImageAssembler((img) => got.push(img), (id, miss) => req.push([id, miss.join(',')]), { stallMs: 100 });
  const bytes = new Uint8Array(1000).map((_, i) => (i * 7 + 3) & 255);
  const crc = NS.crc32(bytes).toString(16).padStart(8, '0');
  const ch = (i) => NS.bytesToB64(bytes.subarray(i * 480, (i + 1) * 480));
  asm.handle(['B', '1', '1000', '3', crc]);
  for (const i of [0, 1, 2]) asm.handle(['C', '1', String(i), ch(i)]);
  asm.handle(['E', '1']);
  check('complete image, CRC ok', got.length === 1 && got[0].ok && got[0].bytes.length === 1000);
  asm.handle(['B', '2', '1000', '3', crc]);
  asm.handle(['C', '2', '0', ch(0)]);
  asm.handle(['C', '2', '2', ch(2)]);
  asm.handle(['E', '2']);
  check('lost chunk is requested again', req.length === 1 && req[0][1] === '1');
  asm.handle(['C', '2', '1', ch(1)]);
  asm.handle(['E', '2']);
  check('image recovered after resend', got.length === 2 && got[1].ok);
  let threw = null;
  try {
    asm.handle(['B', '3', '1000', '3', crc]);
    asm.handle(['C', '3', '0', ch(0)]);
    asm.handle(['C', '3', '1', '%%%not-base64%%%']);
    for (let i = 0; i < 5; i++) asm.handle(['E', '3']);
  } catch (e) { threw = e; }
  check('chunk never arrives / damaged -> failed image, no exception', !threw && got.length === 3 && got[2].ok === false && got[2].missing === 2, threw ? threw.message : `missing=${got[2] && got[2].missing}`);
  asm.handle(['B', '4', '1000', '3', crc]);
  asm.handle(['C', '4', '0', ch(0)]);
  const t0 = Date.now();
  for (let k = 1; k <= 5; k++) asm.poll(t0 + 1000 * k);
  check('stalled image ("IMG E" lost) ends via poll()', got.length === 4 && got[3].ok === false);
  asm.handle(['B', '5', '1000', '3', crc]);
  for (const i of [2, 0, 1]) asm.handle(['C', '5', String(i), ch(i)]);
  asm.handle(['E', '5']);
  check('assembler keeps working after failures', got.length === 5 && got[4].ok);
}

console.log('camera geometry: pixel <-> angle, picture direction and field of view from two photos');
{
  const W = 640;
  let worst = 0;
  for (const s of [1, -1]) for (const hfov of [45, 62, 90]) for (const az of [-25, -3, 0, 7.5, 28]) {
    const x = NS.cam.azToPixel(az, W, 10, hfov, s);
    worst = Math.max(worst, Math.abs(NS.cam.pixelToAz(x, W, 10, hfov, s) - az));
  }
  check('pixelToAz inverts azToPixel (both directions)', worst < 1e-9, `max ${worst.toExponential(1)}`);
  check('direction +1: a larger angle is left of centre; hmirror flips it', NS.cam.azToPixel(15, W, 10, 62, 1) < W / 2 && NS.cam.effDir(1, 1) === -1 && NS.cam.effDir(-1, 0) === -1 && NS.cam.effDir(0, 1) === 0);
  // a lamp 4 deg right of a camera that points 1.5 deg left of the axis, while the LDRs read th = 0.3: cam.off = th - delta
  for (const s of [1, -1]) {
    const camOff = -1.5; const th = 0.3; const lampAz = 50 + th; const camAz = 50 + camOff;
    const cx = NS.cam.azToPixel(lampAz, W, camAz, 62, s);
    const r = NS.cam.boresight(cx, W, th, 62, s);
    check(`boresight recovers cam.off with direction ${s}`, Math.abs(r.off - camOff) < 1e-9, `off ${r.off.toFixed(4)}`);
  }
  // synthetic 1-D scenes seen by a camera, before and after turning +D
  let sd = 99;
  const r01 = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
  const scene = (nEdges, lamp) => {
    const edges = Array.from({ length: nEdges }, () => ({ az: -180 + 360 * r01(), v: 40 + 160 * r01() })).sort((a, b) => a.az - b.az);
    return (az) => { let v = 60; for (const e of edges) if (az >= e.az) v = e.v; return lamp && Math.abs(az - 5) < 1.5 ? 255 : v; };
  };
  const photo = (sc, camAz, hfov, s, expo = 1) => {
    const p = new Float64Array(320);
    for (let i = 0; i < 320; i++) { let a = 0; for (let k = 0; k < 4; k++) a += sc(NS.cam.pixelToAz(((i + (k + 0.5) / 4) / 320) * W, W, camAz, hfov, s)); p[i] = (a / 4) * expo + 2 * gauss(); }
    return p;
  };
  for (const [s, hfov, D, expo] of [[1, 62, 8, 1], [-1, 62, 8, 1.4], [-1, 78, 8, 0.7], [1, 48, 10, 1.2]]) {
    const sc = scene(25, true);
    const r = NS.cam.dirFromProfiles(photo(sc, 20, hfov, s), photo(sc, 20 + D, hfov, s, expo), D);
    check(`two photos (direction ${s}, hfov ${hfov}, exposure x${expo}) -> direction right, hfov within 1 deg`, r.ok && r.s === s && Math.abs(r.hfov - hfov) < 1, `s ${r.s} hfov ${r.hfov.toFixed(2)} score ${r.score.toFixed(2)} vs ${r.other.toFixed(2)}`);
  }
  const bare = scene(0, false);
  const rb = NS.cam.dirFromProfiles(photo(bare, 0, 62, 1), photo(bare, 8, 62, 1), 8);
  check('a bare wall (nothing to compare) is refused, never guessed', !rb.ok, `score ${rb.score.toFixed(2)} vs ${rb.other.toFixed(2)}`);
  check('auto-reconnect matches the same USB device (VID:PID) only', NS.samePort({ usbVendorId: 0x303a, usbProductId: 0x1001 }, { usbVendorId: 0x303a, usbProductId: 0x1001 }) && !NS.samePort({ usbVendorId: 0x303a, usbProductId: 0x1001 }, { usbVendorId: 0x1a86, usbProductId: 0x7523 }) && !NS.samePort({}, {}));
}

console.log('mission 1 pass rule (whole hold window counts)');
{
  const mk = (n, f) => Array.from({ length: n }, (_, i) => ({ st: 3, err: 0.2, valid: true, sat: false, ...f(i) }));
  const J = (samples, o = {}) => NS.m1Judge({ samples, maxGap: o.gap ?? 0.06, last: 10, holdS: 3 }, { tol: 1, hz: 20, now: o.now ?? 10.05 });
  check('steady 3 s hold passes', J(mk(60, () => ({}))).pass);
  check('one sample dropped to FINE -> fail', !J(mk(60, (i) => (i === 30 ? { st: 2 } : {}))).pass);
  check('one sample beyond tolerance -> fail', !J(mk(60, (i) => (i === 10 ? { err: -1.3 } : {}))).pass);
  check('light lost / ADC clipped sample -> fail', !J(mk(60, (i) => (i === 5 ? { sat: true } : {}))).pass);
  check('too few samples -> fail', !J(mk(20, () => ({}))).pass);
  check('gap in telemetry -> fail', !J(mk(60, () => ({})), { gap: 0.9 }).pass);
  check('telemetry stopped before the end -> fail', !J(mk(60, () => ({})), { now: 12 }).pass);
  check('no data at all -> fail', !NS.m1Judge(null, { tol: 1, hz: 20, now: 5 }).pass);
}

console.log('simulator end-to-end (virtual firmware + physics)');
{
  global.performance = global.performance || { now: () => Date.now() };
  const sim = new NS.Sim();
  const out = [];
  sim.onLine = (l) => out.push(l);
  sim.boot();
  const run = (ms) => { for (let t = 0; t < ms; t += 2) sim.step(0.002); };
  sim.handle('@1 HELLO');
  check('HELLO answered', out.some((l) => l.startsWith('J {"type":"hello"')) && out.includes('@1 OK'));
  sim.handle('@2 SET ctl.k 9');
  check('SET out of range rejected', out.some((l) => l.startsWith('@2 ERR RANGE')));
  sim.handle('@3 SET ctl.k 0.8');
  check('SET accepted', out.includes('@3 OK ctl.k=0.8'));
  sim.handle('@21 SET act.in1 19');
  sim.handle('@22 SET sen.pin0 38');
  sim.handle('@23 SET act.in2 30');
  check('SET on a USB / flash / non-ADC pin -> ERR PIN (same rules as the firmware)', out.some((l) => l.startsWith('@21 ERR PIN act.in1=19')) && out.some((l) => l.startsWith('@22 ERR PIN sen.pin0=38')) && out.some((l) => l.startsWith('@23 ERR PIN act.in2=30')) && sim.get('act.in1') === 38 && sim.get('sen.pin0') === 1);
  sim.handle('@24 SET sen.pin1 1');
  check('two keys on one GPIO -> accepted with E WARN PIN', out.includes('@24 OK sen.pin1=1') && out.some((l) => l.startsWith('E WARN PIN GPIO1 sen.pin1 sen.pin0')));
  sim.handle('@25 SET sen.pin1 2');
  // calibration sweep through the protocol
  sim.world.lampAz = 23;
  run(300);
  sim.handle('@4 SWEEP -60 60 5 250 cal');
  run(60000);
  const sp = out.filter((l) => l.startsWith('J {"type":"sweep_pt"')).map((l) => JSON.parse(l.slice(2)));
  check('sweep produced points', sp.length === 25, `n=${sp.length}`);
  const pts2 = sp.map((j) => ({ ang: j.ang, mvL: j.mv[0], mvR: j.mv[1], GL: NS.est.toG(j.mv[0], 3300, 0), GR: NS.est.toG(j.mv[1], 3300, 0) }));
  const f2 = NS.fit.fitPhysical(pts2, { gamma: 0.6, alpha0: 30, fitQ: true });
  const e2 = NS.fit.toEst(f2.P);
  e2.lut = NS.fit.buildLUT(pts2, e2, f2.P.phi, { dx: 1 });
  e2.dmax = NS.fit.range(pts2, e2, f2.P.phi).dmax;
  console.log(`     sim fit: phi=${f2.P.phi.toFixed(2)} (lamp 23 in true frame) alpha=${f2.P.alpha.toFixed(2)} qL=${f2.P.qL.toFixed(3)} qR=${f2.P.qR.toFixed(3)} g=${NS.fit.gain(f2.P).toFixed(3)} rms=${f2.rms.toFixed(4)}`);
  for (const l of [`SET est.alpha ${e2.alpha}`, `SET est.gamma ${e2.gamma}`, `SET est.qL ${e2.qL}`, `SET est.qR ${e2.qR}`, `SET est.g ${e2.g}`, `SET est.aL ${e2.aL}`, `SET est.aR ${e2.aR}`, `SET est.dmax ${e2.dmax}`, `CAL LUT ${e2.lut.x0} ${e2.lut.dx} ${e2.lut.v.join(',')}`]) sim.handle(l);
  sim.handle('@9 SET act.bl 1.4');
  sim.handle('@10 M1 START 0');
  run(25000);
  const holds = out.filter((l) => l.startsWith('E M1 HOLD'));
  check('mission 1 reached HOLD', holds.length > 0, holds[0] || '');
  const tErr = Math.abs(((sim.world.lampAz - sim.bodyTrue() + 540) % 360) - 180);
  check('true pointing error < 0.6 deg after calibration', tErr < 0.6, `true err=${tErr.toFixed(3)}°`);
  // disturbance: bump the body 15 deg, it must re-acquire
  sim.world.bump += 15;
  run(15000);
  const tErr2 = Math.abs(((sim.world.lampAz - sim.bodyTrue() + 540) % 360) - 180);
  check('re-acquires after 15 deg disturbance', tErr2 < 0.6 && sim.m1.state === 3, `true err=${tErr2.toFixed(3)}° state=${NS.M1_STATES[sim.m1.state]}`);
  // an offset past ctl.db but below ctl.hys used to stay while HOLD: now trimmed (both directions), still HOLD
  for (const dir of [1, -1]) {
    const nTrim = out.filter((l) => l.startsWith('E M1TRIM')).length;
    const nFine = out.filter((l) => l.startsWith('E M1 FINE')).length;
    const thBefore = ((sim.world.lampAz - sim.bodyTrue() + 540) % 360) - 180;
    const knock = dir > 0 ? sim.m1.err + 0.65 : sim.m1.err - 0.65; // board error after = -/+0.65 deg
    sim.world.bump += knock;
    run(5000);
    const thAfter = ((sim.world.lampAz - sim.bodyTrue() + 540) % 360) - 180;
    check(`${knock.toFixed(2)} deg knock while HOLD -> trimmed back, never leaves HOLD`,
      out.filter((l) => l.startsWith('E M1TRIM')).length > nTrim && out.filter((l) => l.startsWith('E M1 FINE')).length === nFine && sim.m1.state === 3 && Math.abs(sim.m1.err) <= sim.get('ctl.db') && Math.abs(thAfter) < 0.6,
      `true angle ${thBefore.toFixed(3)} -> ${thAfter.toFixed(3)}°, board err ${sim.m1.err.toFixed(3)}°`);
  }
  // backlash measurement
  sim.handle('@11 M1 STOP');
  sim.handle('@12 BACKLASH');
  run(30000);
  const bl = out.find((l) => l.startsWith('J {"type":"backlash"'));
  const blv = bl ? JSON.parse(bl.slice(2)).deg : NaN;
  check('BACKLASH measures ~1.4 deg', Math.abs(blv - 1.4) < 0.35, `measured=${blv}`);
  // same M1 rules as the firmware: continuous search when the lamp is behind, noise-adaptive locking
  const holdWithin = (ms) => { const n0 = out.length; for (let t = 0; t < ms; t += 100) { run(100); if (out.slice(n0).some((l) => l.startsWith('E M1 HOLD'))) return t + 100; } return null; };
  sim.world.bump = 0;
  sim.handle('GOTO 0');
  run(6000);
  // like the tool's Fit: 'sees the light' = at least 15 % of the total light when facing the lamp (default 0.05 counts room light)
  const nearS = pts2.filter((p) => Math.abs(f2.P.phi - p.ang) < 12).map((p) => NS.est.estimate(p.GL, p.GR, { ...e2, lutOn: 0 }).S);
  sim.handle('SET est.minS ' + +(NS.median(nearS) * 0.15).toPrecision(3));
  sim.world.lampAz = 140;
  const nS = out.length;
  sim.handle('M1 START 0');
  const tS = holdWithin(20000);
  const tErrS = Math.abs(((sim.world.lampAz - sim.bodyTrue() + 540) % 360) - 180);
  check('sim: lamp 140 deg behind -> SEARCH (continuous turn) -> HOLD within 10 s (old scan: 20-29 s)', tS !== null && tS <= 10000 && tErrS < 0.6 && out.slice(nS).some((l) => l.startsWith('E M1 SEARCH')), `${tS} ms, true err ${tErrS.toFixed(3)}°`);
  sim.handle('M1 STOP');
  sim.world.lampAz = 23;
  sim.world.noiseMv = 25;
  sim.handle('GOTO 0');
  run(6000);
  sim.handle('M1 START 0');
  const tN = holdWithin(20000);
  run(2000);
  const tErrN = Math.abs(((sim.world.lampAz - sim.bodyTrue() + 540) % 360) - 180);
  check('sim: 25 mV ADC noise -> ctl.adapt still locks within 12 s', tN !== null && tN <= 12000 && tErrN < 0.8, `${tN} ms, true err ${tErrN.toFixed(3)}°`);
  sim.handle('M1 STOP');
  sim.world.noiseMv = 4;
  // telemetry header and rows
  check('telemetry flowing', out.some((l) => l.startsWith('TH,')) && out.filter((l) => l.startsWith('T,')).length > 100);
  check('no FAULT events', !out.some((l) => l.startsWith('E FAULT')), out.filter((l) => l.startsWith('E FAULT')).join(' | '));
}

(async () => {
  console.log('mission 2: sun-referenced pointing after a bump (backlash + boresight + steps-per-rev calibrated)');
  const sim = new NS.Sim();
  const out = [];
  sim.onLine = (l) => out.push(l);
  sim.render = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  const run = async (ms) => { for (let t = 0; t < ms; t += 2) { sim.step(0.002); if (t % 200 === 0) await null; } };
  sim.world.lampAz = 25;
  sim.world.targetAz = -40;
  await run(300);
  sim.handle('SWEEP -60 60 5 200 cal');
  await run(45000);
  const sp = out.filter((l) => l.startsWith('J {"type":"sweep_pt"')).map((l) => JSON.parse(l.slice(2)));
  const pts3 = sp.map((j) => ({ ang: j.ang, mvL: j.mv[0], mvR: j.mv[1], GL: NS.est.toG(j.mv[0], 3300, 0), GR: NS.est.toG(j.mv[1], 3300, 0) }));
  const f3 = NS.fit.fitPhysical(pts3, { gamma: 0.6, alpha0: 30, fitQ: true });
  const e3 = NS.fit.toEst(f3.P);
  e3.lut = NS.fit.buildLUT(pts3, e3, f3.P.phi, { dx: 1 });
  e3.dmax = NS.fit.range(pts3, e3, f3.P.phi).dmax;
  for (const l of [`SET est.alpha ${e3.alpha}`, `SET est.qL ${e3.qL}`, `SET est.qR ${e3.qR}`, `SET est.g ${e3.g}`, `SET est.aL ${e3.aL}`, `SET est.aR ${e3.aR}`, `SET est.dmax ${e3.dmax}`, `CAL LUT ${e3.lut.x0} ${e3.lut.dx} ${e3.lut.v.join(',')}`, 'SET act.bl 1.4', 'SET cam.off 2.2', 'SET ctl.db 0.15', 'SET act.spr 4076']) sim.handle(l);
  sim.world.bump += 15;
  sim.handle('M2 GO SUN -65');
  await run(20000);
  const meta = out.filter((l) => l.startsWith('J {"type":"img_meta"')).map((l) => JSON.parse(l.slice(2))).pop();
  check('image produced with sun reference', meta && meta.ref === 'sun', meta ? `sun_az=${meta.sun_az}` : '');
  check('camera points at target within 0.6 deg (true)', meta && Math.abs(meta.sim_truth_err) < 0.6, meta ? `true err=${meta.sim_truth_err}°` : '');
  // steps-per-rev calibration: one full turn between two sun nulls
  sim.handle('SET act.spr 4096');
  sim.handle('SET act.max 720');
  sim.handle('SPR');
  await run(40000);
  const spr = out.filter((l) => l.startsWith('J {"type":"spr"')).map((l) => JSON.parse(l.slice(2))).pop();
  check('SPR measures ~4076 steps/rev', spr && Math.abs(spr.steps - 4076) < 8, spr ? `measured=${spr.steps}` : out.filter((l) => l.startsWith('E FAULT')).join(' | '));
  console.log('review scenarios in the simulator (same rules as the firmware)');
  {
    const s2 = new NS.Sim();
    const o2 = [];
    s2.onLine = (l) => o2.push(l);
    s2.render = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const run2 = async (ms) => { for (let t = 0; t < ms; t += 2) { s2.step(0.002); if (t % 200 === 0) await null; } };
    await run2(300);
    // 1) lamp so bright that both ADC channels clip: never HOLD, say why
    s2.world.lampK = 100;
    s2.handle('M1 START 0');
    await run2(25000);
    check('clipped ADC: M1 never declares HOLD', !o2.some((l) => l.startsWith('E M1 HOLD')));
    check('clipped ADC: reason reported (adc_saturated)', o2.some((l) => /E M1 (LOST|SEARCH) adc_saturated/.test(l)));
    s2.handle('STOP');
    s2.world.lampK = 1;
    // 2) target outside the actuator range: no photo, explicit snap_fail
    o2.length = 0;
    s2.handle('M2 GO 250');
    await run2(3000);
    const sf = o2.find((l) => l.startsWith('J {"type":"snap_fail"'));
    check('M2 GO 250 -> snap_fail target_out_of_range, no photo', sf && JSON.parse(sf.slice(2)).reason === 'target_out_of_range' && !o2.some((l) => l.startsWith('J {"type":"img_meta"')));
    // 3) pointing worse than m2.tol: no photo
    o2.length = 0;
    s2.handle('GOTO 0');
    await run2(12000);
    o2.length = 0;
    s2.handle('SET act.spr 400'); // coarse steps (0.9 deg) so the reachable angle misses the target by 0.2 deg
    s2.handle('SET m2.tol 0.05');
    s2.handle('M2 GO -40.3');
    await run2(6000);
    const sf2 = o2.find((l) => l.startsWith('J {"type":"snap_fail"'));
    check('pointing outside m2.tol -> snap_fail not_in_tol', sf2 && JSON.parse(sf2.slice(2)).reason === 'not_in_tol', sf2 || o2.filter((l) => l.startsWith('E ')).join(' | '));
    s2.handle('SET m2.tol 1');
    s2.handle('SET act.spr 4096');
    // 4) out-of-range mission targets are errors, never silently the old value
    o2.length = 0;
    s2.handle('@1 M1 START 100');
    s2.handle('@2 M2 GO 500');
    check('M1 START 100 / M2 GO 500 -> ERR RANGE', o2.includes('@1 ERR RANGE m1.tgt -80..80') && o2.includes('@2 ERR RANGE m2.tgt -360..360'), o2.join(' | '));
    // 5) photo while mission 1 holds (boresight check), and GO taking over from M1
    s2.handle('M1 START 0');
    await run2(20000);
    o2.length = 0;
    s2.handle('@3 M2 SNAP');
    await run2(2000);
    const mm = o2.find((l) => l.startsWith('J {"type":"img_meta"'));
    check('M2 SNAP works while M1 holds', o2.includes('@3 OK started') && mm && JSON.parse(mm.slice(2)).m1 === 'HOLD', o2.filter((l) => !l.startsWith('T,')).slice(0, 4).join(' | '));
    o2.length = 0;
    s2.handle('@4 M2 GO -40');
    await run2(8000);
    check('M2 GO stops M1 by itself and shoots', o2.includes('E M1 IDLE m2_takeover') && o2.some((l) => l.startsWith('J {"type":"img_meta"')));
    // 6) AMB right after the lamp goes off still measures the room light, not the fading lamp
    s2.world.lampOn = false;
    o2.length = 0;
    s2.handle('AMB 500');
    await run2(6000);
    const am = o2.find((l) => l.startsWith('J {"type":"amb"'));
    const gAmb = 1 / (s2.truth.r10L * Math.pow((s2.world.ambient + 0.002) / 0.1, -s2.truth.gammaL)) * s2.truth.rf;
    const aTrue = Math.pow(gAmb, 1 / 0.6);
    const aMeas = am ? JSON.parse(am.slice(2)).aL : NaN;
    check('AMB waits for the LDR to settle (aL within 3 % of the true room light)', Math.abs(aMeas / aTrue - 1) < 0.03, `aL ${aMeas} vs true ${aTrue.toFixed(5)}`);
    s2.world.lampOn = true;
    // 7) CAL TH0: an outside reference fixes the absolute zero
    s2.handle('GOTO 20');
    await run2(3000);
    const thTrue = ((s2.world.lampAz - s2.bodyTrue() + 540) % 360) - 180;
    o2.length = 0;
    s2.handle(`CAL TH0 ${thTrue.toFixed(3)}`);
    await run2(2000);
    const tj = o2.find((l) => l.startsWith('J {"type":"th0"'));
    s2.handle('RAW 300');
    await run2(600);
    const rw = o2.filter((l) => l.startsWith('J {"type":"raw"')).map((l) => JSON.parse(l.slice(2))).pop();
    check('CAL TH0: reading equals the outside reference afterwards', tj && rw && Math.abs(rw.th - thTrue) < 0.15, rw ? `th ${rw.th} vs reference ${thTrue.toFixed(3)}` : '');
    check('CAL TH0 stores the zero in flash by itself (saved:true, nvs = live value)', tj && JSON.parse(tj.slice(2)).saved === true && s2.nvs.get('est.th0') === s2.cfg.get('est.th0'));
    check('no unexpected FAULT (only the intended snap_fail ones)', o2.filter((l) => l.startsWith('E FAULT')).length === 0, o2.filter((l) => l.startsWith('E FAULT')).join(' | '));
  }
  console.log('simulator: no laptop (housekeeping, BOOT button, automatic start) and photo metadata (same rules as the firmware)');
  {
    const s3 = new NS.Sim();
    const o3 = [];
    s3.onLine = (l) => o3.push(l);
    s3.render = () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const run3 = async (ms) => { for (let t = 0; t < ms; t += 2) { s3.step(0.002); if (t % 200 === 0) await null; } };
    s3.boot();
    await run3(4500);
    const hk = o3.filter((l) => l.startsWith('J {"type":"hk"')).map((l) => JSON.parse(l.slice(2)));
    check('J hk every 2 s: temperature, memory, button, no battery without hw.vbat', hk.length >= 2 && NS.isNum(hk[0].temp_c) && hk[0].vbat_mv === null && hk[0].btn === 0, hk[0] ? JSON.stringify(hk[0]) : 'none');
    s3.handle('@1 SET hw.vbat 38');
    s3.handle('@2 SET hw.vbat 4');
    check('hw.vbat needs an ADC pin (GPIO38 refused, GPIO4 fine)', o3.some((l) => l.startsWith('@1 ERR PIN hw.vbat=38')) && o3.includes('@2 OK hw.vbat=4'));
    check('BOOT button -> E BTN M1_START and mission 1 runs', s3.pressButton() && o3.includes('E BTN M1_START') && s3.proc && s3.proc.name === 'M1');
    await run3(500);
    s3.pressButton();
    check('second press -> E BTN M1_STOP, mission 1 idle', o3.includes('E BTN M1_STOP') && s3.m1.state === 0 && !s3.proc);
    s3.handle('@3 SET m1.auto 2');
    s3.handle('@4 SAVE m1.auto');
    check('SAVE m1.auto stores only that key', o3.includes('@4 OK saved 1') && s3.nvs.get('m1.auto') === 2 && s3.nvs.get('hw.vbat') === -1);
    o3.length = 0;
    s3.handle('REBOOT');
    await new Promise((r) => setTimeout(r, 350));
    await run3(3000);
    check('m1.auto 2 -> E AUTO M1_IN 2 at boot, E AUTO M1_START 2 s later, mission 1 runs', o3.includes('E AUTO M1_IN 2') && o3.includes('E BOOT SOFTWARE') && o3.includes('E AUTO M1_START') && s3.proc && s3.proc.name === 'M1', o3.filter((l) => l.startsWith('E ')).slice(0, 6).join(' | '));
    s3.handle('STOP');
    o3.length = 0;
    s3.handle('REBOOT');
    await new Promise((r) => setTimeout(r, 350));
    s3.handle('STOP');
    await run3(3000);
    check('STOP while it waits -> E AUTO CANCELLED, no automatic start', o3.includes('E AUTO CANCELLED') && !o3.includes('E AUTO M1_START') && !s3.proc);
    s3.handle('SET m1.auto 0');
    o3.length = 0;
    s3.handle('@5 SET cam.hmirror 1');
    s3.handle('@6 SET cam.dir -1');
    s3.handle('@7 M2 SNAP');
    await run3(1500);
    const mm = o3.filter((l) => l.startsWith('J {"type":"img_meta"')).map((l) => JSON.parse(l.slice(2))).pop();
    check('img_meta carries hm / vf / cam_dir / hfov for the pixel -> angle maths', mm && mm.hm === 1 && mm.vf === 0 && mm.cam_dir === -1 && mm.hfov === 62, mm ? JSON.stringify({ hm: mm.hm, vf: mm.vf, cam_dir: mm.cam_dir, hfov: mm.hfov }) : 'no photo');
    s3.handle('@8 SET cam.model 4');
    s3.handle('@9 M2 INIT');
    check('M2 INIT with cam.model 4 (ESP32-CAM pins) on the S3 model -> ERR CAM like the firmware', o3.some((l) => l.startsWith('@9 ERR CAM cam.model 4 not for this chip')));
    // the simulated camera module is mounted upside down: raw direction -1, hmirror 1 makes it +1 (like the real maths)
    check('simulated camera: raw direction -1, so hmirror 1 gives +1', NS.cam.effDir(s3.truth.camDir, 1) === 1 && NS.cam.effDir(s3.truth.camDir, 0) === -1);
  }
  // ---- rules (06b_rules.js): Thai fixes and the verdict panels ----
  console.log('rules');
  {
    const R = NS.rules;
    check('errHelp BUSY names the job that is running', R.errHelp('@4 ERR BUSY SWEEP').includes('SWEEP') && R.errHelp('@4 ERR BUSY SWEEP').includes('STOP'), R.errHelp('@4 ERR BUSY SWEEP'));
    check('errHelp RANGE reads the range from the text (also behind "cmd → ")', R.errHelp('SET ctl.k 9 → ERR RANGE ctl.k 0.1..1.5') === 'ค่าต้องอยู่ในช่วง 0.1..1.5', R.errHelp('SET ctl.k 9 → ERR RANGE ctl.k 0.1..1.5'));
    check('errHelp RANGE reads a %g limit like 2e+06 as a plain number', R.errHelp('@3 ERR RANGE com.baud 1200..2e+06') === 'ค่าต้องอยู่ในช่วง 1200..2000000', R.errHelp('@3 ERR RANGE com.baud 1200..2e+06'));
    check('errHelp FAULT adc_saturated / camera chip / unknown', R.errHelp('FAULT: SWEEP adc_saturated').includes('ถอยหลอด') && R.errHelp('@9 ERR CAM cam.model 4 not for this chip').includes('ESP32-CAM') && R.errHelp('อะไรไม่รู้') === '' && R.errHelp('') === '');
    const ok = { maeLut: 0.2, maxLut: 0.6, gL: 0.6, gR: 0.62, ambSource: 'AMB', nSat: 0, gRatioUsed: true, rangeLo: -35, rangeHi: 35 };
    const v0 = R.fitVerdict(ok);
    check('fitVerdict: all good -> ok, title starts with ✓ and has 7 rows', v0.level === 'ok' && v0.title.startsWith('✓ ผ่าน') && v0.items.length === 7, v0.title);
    check('fitVerdict MAE edges: 0.299 ok, 0.3 warn, 0.599 warn, 0.6 bad', [0.299, 0.3, 0.599, 0.6].map((x) => R.fitVerdict({ ...ok, maeLut: x }).level).join() === 'ok,warn,warn,bad');
    const v1 = R.fitVerdict({ ...ok, ambSource: 'sweep', gRatioUsed: false, nSat: 2, gL: 0.95, rangeHi: -10 });
    check('fitVerdict: skipped AMB / gamma ratio / saturated points / odd gamma / short range are warnings, not failures', v1.level === 'warn' && v1.items.filter((i) => i.level === 'warn').length === 5 && v1.title.startsWith('! เตือน'), v1.items.map((i) => i.level).join());
    check('fitVerdict: MAE >= 0.6 -> bad, title starts with ✕', R.fitVerdict({ ...ok, maeLut: 0.8 }).title.startsWith('✕ ไม่ผ่าน') && R.fitVerdict({ ...ok, maeLut: NaN }).level === 'bad');
    check('valVerdict: ok / bias warns / few points warns / big MAE bad', [R.valVerdict({ mae: 0.2, mean: 0.05, n: 6 }).level, R.valVerdict({ mae: 0.2, mean: -0.3, n: 6 }).level, R.valVerdict({ mae: 0.2, mean: 0, n: 3 }).level, R.valVerdict({ mae: 0.7, mean: 0, n: 6 }).level].join() === 'ok,warn,warn,bad');
    check('m1Chip: HOLD green "ล็อกแล้ว", LOST red, IDLE muted, SEARCH/FINE info, unknown safe', R.m1Chip(3).level === 'ok' && R.m1Chip(3).text === 'ล็อกแล้ว' && R.m1Chip(4).level === 'bad' && R.m1Chip(0).level === 'muted' && R.m1Chip(1).level === 'info' && R.m1Chip(2).level === 'info' && R.m1Chip(undefined).level === 'muted');
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
