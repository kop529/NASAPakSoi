// Node tests for the non-DOM parts of NasaSat Lab.  Usage: node tests/run_tests.js
'use strict';
const path = require('path');
const js = path.join(__dirname, '..', 'src', 'js');
for (const f of ['01_util.js', '02_protocol.js', '02b_sunseek.js', '03b_ble.js', '03_serial.js', '04_estimator.js', '05_cam.js', '05_fit.js', '06_cfgdefs.js', '06b_rules.js', '07_sim.js']) require(path.join(js, f));
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

console.log('SunSeek team firmware calibration (W4): NS.fit.calibrate + TEAM_* command list');
{
  const amb = sample(0, 0, 0.03, 0); // lamp off
  const c = NS.fit.calibrate(pts, { gamma: 0.6, alpha0: 30, fitQ: true, amb: { GL: amb.GL, GR: amb.GR }, vcc: 3300, topo: 0, lutDx: 1, positiveAlpha: true });
  const m = NS.fit.metrics(NS.fit.errors(val, c.est, c.phi).map((e) => e.err));
  check('calibrate(): same quality as the step-by-step fit', m.mae < 0.3 && !c.flipped && c.r.P.alpha > 0, `MAE ${m.mae.toFixed(3)} alpha ${c.r.P.alpha.toFixed(2)}`);
  // the marks on the SunSeek platform counted the other way: alpha comes out negative unless flipped
  const rev = pts.map((p) => ({ ...p, ang: -p.ang }));
  const cNo = NS.fit.calibrate(rev, { gamma: 0.6, fitQ: true, vcc: 3300, topo: 0 });
  const cYes = NS.fit.calibrate(rev, { gamma: 0.6, fitQ: true, vcc: 3300, topo: 0, positiveAlpha: true });
  check('reversed marks give a negative alpha', cNo.r.P.alpha < 0, `${cNo.r.P.alpha.toFixed(2)}`);
  check('positiveAlpha flips them back (same sign as 90*NDV)', cYes.flipped && cYes.r.P.alpha > 0 && cYes.all[0].ang === pts[0].ang, `${cYes.r.P.alpha.toFixed(2)}`);
  const s20 = sample(20, 1, 0.03, 0);
  const th20 = NS.est.estimate(s20.GL, s20.GR, cYes.est).theta;
  const ndv = (s20.mvL - s20.mvR) / (s20.mvL + s20.mvR);
  check('flipped calibration: team angle has the sign of the organizer angle', Math.sign(th20) === Math.sign(ndv) && Math.abs(th20 - 20) < 0.5, `θ ${th20.toFixed(2)} NDV ${ndv.toFixed(3)}`);

  const L = NS.ss.teamLines(c.est);
  check('team lines: TEAM_SET sun.* first, sun.model 1 then TEAM_SAVE last', /^TEAM_SET,sun\.vcc,3300$/.test(L[0]) && L[L.length - 2] === 'TEAM_SET,sun.model,1' && L[L.length - 1] === 'TEAM_SAVE');
  check('team lines: every line < 240 characters', L.every((l) => l.length < 240), `${Math.max(...L.map((l) => l.length))}`);
  const b = L.find((l) => l.startsWith('TEAM_LUT_BEGIN,'));
  const n = +b.split(',')[3];
  const vals = L.filter((l) => l.startsWith('TEAM_LUT_DATA,')).flatMap((l) => l.split(',').slice(2).map(Number));
  check('team lines: LUT data covers BEGIN n exactly, in order', vals.length === n && vals.every((v, i) => v === c.est.lut.v[i]) && L.includes('TEAM_LUT_END') && L.includes('TEAM_SET,sun.lut,1'), `n ${n}`);
  const firstIdx = L.filter((l) => l.startsWith('TEAM_LUT_DATA,')).map((l) => +l.split(',')[1]);
  check('team lines: each DATA line starts where the last ended', firstIdx[0] === 0 && firstIdx.every((x, i) => i === 0 || x > firstIdx[i - 1]));
  const noLut = NS.ss.teamLines({ ...c.est, lut: null });
  check('team lines without a LUT clear the old one', noLut.includes('TEAM_LUT_CLEAR') && noLut.includes('TEAM_SET,sun.lut,0'));
  let threw = '';
  try { NS.ss.teamLines({ ...c.est, alpha: -30 }); } catch (e) { threw = e.message; }
  check('team lines refuse alpha the firmware refuses', /α/.test(threw), threw);
  const big = { ...c.est, lut: { x0: -100, dx: 0.5, v: new Array(300).fill(0.1) } };
  threw = '';
  try { NS.ss.teamLines(big); } catch (e) { threw = e.message; }
  check('team lines refuse a LUT longer than 256', /256/.test(threw));

  const a = NS.ss.avgTeamT([{ MVL: 1000, MVR: 2000, SAT: 0, TH: 1, ANG: 2 }, { MVL: 1010, MVR: 1990, SAT: 1, TH: 3, ANG: 2 }, { MVL: NaN, MVR: 1 }]);
  check('avgTeamT: mean, spread, any clip', a.n === 2 && a.mvL === 1005 && a.mvR === 1995 && a.sdL === 5 && a.sat && a.th === 2);
  check('avgTeamT: nothing usable -> null', NS.ss.avgTeamT([{ MVL: NaN, MVR: NaN }]) === null);
  check('th0For: read 2.5 deg at the reference 0 with th0 1 -> -1.5', NS.ss.th0For(1, 2.5, 0) === -1.5);
  threw = '';
  try { NS.ss.th0For(80, -20, 0); } catch (e) { threw = e.message; }
  check('th0For refuses more than 90 deg', /90/.test(threw));
  // W3 sign checks on synthetic TM,TEAM_T rows (20 Hz): angle follows a hand turn, the gyro reads +/- that rate
  const turn = (gs, extra = {}) => Array.from({ length: 100 }, (_, i) => { const t = i * 50; const w = 2 * Math.PI * 0.4; return { T: t, ANG: 20 * Math.sin(w * t / 1000), GZ: gs * 20 * w * Math.cos(w * t / 1000) * NS.RAD / NS.RAD, LIT: 1, SAT: 0, ...extra }; });
  check('gyroSign: rate matches the angle -> ok', NS.ss.gyroSign(turn(1)).verdict === 'ok');
  check('gyroSign: rate opposite -> flip', NS.ss.gyroSign(turn(-1)).verdict === 'flip');
  check('gyroSign: no IMU (rate 0) -> nogyro', NS.ss.gyroSign(turn(0)).verdict === 'nogyro');
  check('gyroSign: no light -> not counted (move)', NS.ss.gyroSign(turn(1, { LIT: 0 })).verdict === 'move');
  const kick = (dir) => Array.from({ length: 60 }, (_, i) => ({ T: i * 50, ANG: i * 50 > 1000 ? dir * Math.min(3, (i * 50 - 1000) / 200) : 0, GZ: 0, LIT: 1, SAT: 0 }));
  check('kickSign: angle grows after a + kick -> adcs.sign 1', NS.ss.kickSign(kick(1), 1000).verdict === 1);
  check('kickSign: angle falls -> adcs.sign -1', NS.ss.kickSign(kick(-1), 1000).verdict === -1);
  check('kickSign: body did not move -> unclear', NS.ss.kickSign(kick(0), 1000).verdict === 'unclear');
  check('errHelp knows the team codes', /MANUAL/.test(NS.ss.errHelp('ERR,TEAM_REQUIRES_MANUAL,sun.model')) && /RW_BIAS|MOMENTUM/.test(NS.ss.errHelp('ERR,RW_CMD_REQUIRES_MOMENTUM_STRATEGY')));
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
  // ---- SunSeek protocol (02b_sunseek.js): the organizer firmware's lines, copied from its source ----
  console.log('sunseek protocol (organizer firmware v2.1)');
  {
    const P = NS.ss.parse;
    const status = [ // what STATUS prints (System_CommandRouter.h ttcStatus + System_Telemetry.h) with the default config values
      'ACK,STATUS',
      'TM,SAT_ID,SUNSEEK-Team_DekMUT,BLE,DISCONNECTED,ADCS_MODE,MANUAL,ADCS_STRATEGY,REACTION',
      'TM,ADCS_MODE,MANUAL,ADCS_REFERENCE,SUN,TARGET,0.00,KP,2.000,KD,0.500,MOMENTUM_BIAS,40,DEADBAND,2.00,MAX_RW_COMMAND,80,CONTROL_SIGN,1.0',
      'TM,RW_CMD,0,RW_BIAS,0,RW_STATE,STOPPED',
      'TM,SENSOR_ACCEL,READY',
      'TM,SENSOR_MAG,READY',
      'TM,SENSOR_GYRO,READY',
      'TM,SENSOR_BARO,NOT_DETECTED',
      'TM,SENSOR_SUN,READY',
      'TM,ESTIMATOR,STANDARD,EST_FILTER,ON,EST_FILTER_TYPE,MOVING_AVERAGE,EST_MA_WINDOW,500,EST_FILTER_STRENGTH,0.50,EST_FUSION,OFF,EST_GYRO_WEIGHT,0.50',
      'TM,SUN_L,1834,SUN_R,1790,SUN_NDV,0.0121,SUN_ANGLE,-1.23,SUN_ERROR,1.23,MAG_X,12.50,MAG_Y,-3.20,MAG_Z,40.10,MAG_HEADING,274.30,GYRO_Z,0.021,RW_CMD,0',
      'TM,ADCS_MODE,MANUAL,ADCS_REFERENCE,SUN,TARGET,0.00,POINTING_ERROR,-4.20,SUN_ERROR,-4.20,MAG_ERROR,31.50,GYRO_Z,2.130,RW_CMD,0',
      'TM,EST_RAW,-4.20,EST_FILTERED,-4.18,EST_ANGLE,-4.18,EST_FILTER,ON,EST_FILTER_TYPE,MOVING_AVERAGE,EST_MA_WINDOW,500,EST_FILTER_STRENGTH,0.50',
      'TM,EST_FUSION,OFF,EST_GYRO_WEIGHT,0.50,EST_VALID,1',
    ];
    const a1 = P('ACK,RW,30.0');
    check('parse ACK,RW,30.0 -> cmd RW, args [30.0]', a1.kind === 'ack' && a1.ack.cmd === 'RW' && a1.ack.args.join() === '30.0' && a1.raw === 'ACK,RW,30.0');
    check('parse ACK,STATUS / ACK,TM_STREAM,SUN,ON / ACK,ADCS_TUNE,2.000,0.500,40', P('ACK,STATUS').ack.cmd === 'STATUS' && P('ACK,STATUS').ack.args.length === 0 && P('ACK,TM_STREAM,SUN,ON').ack.args.join() === 'SUN,ON' && P('ACK,ADCS_TUNE,2.000,0.500,40').ack.args.join() === '2.000,0.500,40');
    check('parse PONG', P('PONG').kind === 'pong' && P('PONG\r').kind === 'pong');
    const e1 = P('ERR,RW_REQUIRES_REACTION_STRATEGY');
    const e2 = P('ERR,GYRO_OFFSET,GYRO_NOT_READY');
    check('parse ERR with and without args (ERR does not name the command)', e1.kind === 'err' && e1.err.code === 'RW_REQUIRES_REACTION_STRATEGY' && e1.err.args.length === 0 && e2.err.code === 'GYRO_OFFSET' && e2.err.args.join() === 'GYRO_NOT_READY' && P('ERR,ADCS_PREPARE,GYRO_NOT_READY').err.args[0] === 'GYRO_NOT_READY');
    const t1 = P('TM,SUN_L,1834,SUN_R,1790,SUN_NDV,0.0121,SUN_ANGLE,-1.23');
    check('parse even TM = KEY,VALUE pairs (numbers in .num)', t1.kind === 'tm' && t1.tm.group === null && t1.tm.kv.SUN_L === '1834' && t1.tm.num.SUN_NDV === 0.0121 && t1.tm.num.SUN_ANGLE === -1.23 && Object.keys(t1.tm.kv).length === 4);
    const t2 = P('TM,SENSOR_GYRO,READY');
    check('parse TM,SENSOR_GYRO,READY -> text value, no number', t2.tm.group === null && t2.tm.kv.SENSOR_GYRO === 'READY' && !('SENSOR_GYRO' in t2.tm.num));
    const t3 = P('TM,CAL_GYRO_OFFSET,X,0.1234,Y,-0.0456,Z,0.0078,SAMPLES,300');
    check('parse odd TM = GROUP then pairs (CAL_GYRO_OFFSET)', t3.tm.group === 'CAL_GYRO_OFFSET' && t3.tm.kv.X === '0.1234' && t3.tm.num.Y === -0.0456 && t3.tm.num.SAMPLES === 300 && Object.keys(t3.tm.kv).join() === 'X,Y,Z,SAMPLES');
    const t4 = P('TM,TM_STREAM,SUN,ON,MAG,OFF,GYRO,ON,ADCS,OFF,RATE_HZ,10');
    const t5 = P('TM,ADCS_PREPARE,STRATEGY,MOMENTUM,BIAS,40,QUALIFICATION,BASELINE');
    check('parse odd TM: TM_STREAM and ADCS_PREPARE groups', t4.tm.group === 'TM_STREAM' && t4.tm.kv.SUN === 'ON' && t4.tm.num.RATE_HZ === 10 && t5.tm.group === 'ADCS_PREPARE' && t5.tm.kv.STRATEGY === 'MOMENTUM' && t5.tm.num.BIAS === 40);
    const t6 = P(status[11]);
    check('parse a long even TM (ADCS snapshot: 8 pairs, negative numbers)', t6.tm.group === null && Object.keys(t6.tm.kv).length === 8 && t6.tm.kv.ADCS_MODE === 'MANUAL' && t6.tm.num.POINTING_ERROR === -4.2 && t6.tm.num.GYRO_Z === 2.13);
    const th = P('TM,HELP,ADCS_REFERENCE,SUN|MAG|SET_TARGET,<deg>');
    check('parse TM,HELP,<text> -> help text with its commas, not data', th.kind === 'help' && th.help === 'ADCS_REFERENCE,SUN|MAG|SET_TARGET,<deg>' && !th.tm);
    const v1 = P('EVT,RW_MANEUVER_COMPLETE,60');
    const v2 = P('EVT,CAL,GYRO_OFFSET,COMPLETE');
    check('parse EVT with and without args', v1.kind === 'evt' && v1.evt.name === 'RW_MANEUVER_COMPLETE' && v1.evt.args.join() === '60' && P('EVT,SAFE').evt.name === 'SAFE' && P('EVT,MISSION_READY').evt.args.length === 0 && v2.evt.name === 'CAL' && v2.evt.args.join() === 'GYRO_OFFSET,COMPLETE');
    const pl = P('PAYLOAD,STATUS,READY,CAMERA,OK,SD,OK,WIFI,READY,IP,192.168.4.1,IMAGE_COUNT,12,LAST_IMAGE,/IMG_0012.JPG');
    check('parse PAYLOAD lines of the camera board (a forwarded PAYLOAD,ERR is not an ERR of the board)', pl.kind === 'payload' && pl.payload.sub === 'STATUS' && pl.payload.text.startsWith('STATUS,READY') && P('PAYLOAD,IMAGE_READY,/IMG_0013.JPG,245731').payload.args.join() === '/IMG_0013.JPG,245731' && P('PAYLOAD,ERR,CAMERA_FAIL').kind === 'payload');
    check('plain text: boot banner, spacecraft id, BLE and payload UART lines', ['SUNSEEK PLATFORM v2.1 — Training Firmware', 'Spacecraft ID: SUNSEEK-Team_DekMUT', 'BLE client connected', 'Payload UART: TX=GPIO41 RX=GPIO42 @115200'].every((l) => P(l).kind === 'text' && P(l).raw === l));
    const junk = ['', '   ', 'ACK', 'ACK,', 'ERR,', 'EVT,', 'TM', 'TM,', 'TM,,', ',,,', ',', 'ack,RW', 'Pong', 'PONGO', '\u0000\u0001garbage', 'ERR RANGE ctl.k', '@1 OK', null, undefined, 42, {}, [], { toString() { throw new Error('boom'); } }];
    let threw = false;
    let kinds = '';
    for (const b of junk) { try { kinds += P(b).kind === 'text' ? 't' : '?'; } catch (_) { threw = true; } }
    check('malformed input never throws and stays plain text (case-sensitive like the board)', !threw && kinds === 't'.repeat(junk.length), kinds);
    check('odd TM with a dangling token and a 20 kB line parse without error', P('TM,A,1,B').tm.group === 'A' && P('TM,' + 'K,1,'.repeat(5000) + 'X').kind === 'tm');
    check('whitespace around tokens is trimmed (the board trims too)', P('  ACK , RW , 30.0 \r').ack.cmd === 'RW' && P('TM, SUN_L , 1834 ').tm.num.SUN_L === 1834);

    const L = NS.ss.looksLikeSunSeek;
    check('looksLikeSunSeek: PONG / ACK, / ERR, / TM, / EVT, / PAYLOAD, / boot banner', ['PONG', 'ACK,STATUS', 'ERR,UNKNOWN_COMMAND', 'TM,SENSOR_SUN,READY', 'EVT,SAFE', 'PAYLOAD,EVENT,CAPTURE_STARTED', 'SUNSEEK PLATFORM v2.1 — Training Firmware', 'Spacecraft ID: SUNSEEK-Team_DekMUT'].every(L));
    check('looksLikeSunSeek: NasaSat lines and noise are not SunSeek', ['@1 OK', '@3 ERR RANGE ctl.k 0.1..1.5', 'ERR RANGE x', 'T,1,2,3', 'TH,a,b', 'J {"type":"hello"}', 'E M1 HOLD t=1', '# ready', 'IMG B 1 2 3 4', 'BLE client connected', 'Payload UART: TX=GPIO41', '', null, undefined, 'PONGO', 'ets Jun  8 2016 00:22:57'].every((l) => !L(l)));
    {
      const sx = new NS.Sim();
      const ox = [];
      sx.onLine = (l) => ox.push(l);
      sx.boot();
      for (const c of ['@1 HELLO', '@2 CFG LIST', '@3 STREAM ON', '@4 CAL GET', '@5 DIAG', '@6 HWID', '@7 RAW 300', '@8 HELP', '@9 M1 START 0', '@10 BOGUS', '@11 SET ctl.k 9', '@12 STOP']) sx.handle(c);
      for (let t = 0; t < 3000; t += 2) sx.step(0.002);
      check('no line of the NasaSat simulator is mistaken for SunSeek (no false "switch" hint)', ox.length > 50 && !ox.some((l) => L(l)), `${ox.length} lines, first hit: ${ox.find((l) => L(l))}`);
    }

    const st = new NS.ss.State();
    status.forEach((l, i) => st.apply(P(l), 1000 + i));
    check('State keeps the latest value of every TM key with its time (STATUS dump)', st.get('SAT_ID') === 'SUNSEEK-Team_DekMUT' && st.get('BLE') === 'DISCONNECTED' && st.get('RW_STATE') === 'STOPPED' && st.get('SENSOR_BARO') === 'NOT_DETECTED' && st.get('SENSOR_GYRO') === 'READY' && st.num('RW_BIAS') === 0 && st.num('KP') === 2 && st.at('SENSOR_SUN') === 1008 && st.age('SENSOR_SUN', 1500) === 492);
    check('State: unknown key -> undefined / NaN / never / infinite age; text is not a number', st.get('NOPE') === undefined && Number.isNaN(st.num('NOPE')) && st.at('NOPE') === 0 && st.age('NOPE') === Infinity && Number.isNaN(st.num('SAT_ID')));
    check('State: a newer value replaces the older one (ADCS_MODE and SUN_ERROR arrive twice)', st.at('ADCS_MODE') === 1011 && st.num('SUN_ERROR') === -4.2 && st.at('SUN_ERROR') === 1011 && st.lines === status.length);
    check('State.keys(prefix) lists the keys that start with it (the status card reads SENSOR_*)', st.keys('SENSOR_').sort().join() === 'SENSOR_ACCEL,SENSOR_BARO,SENSOR_GYRO,SENSOR_MAG,SENSOR_SUN' && st.keys().length > 20 && st.keys('NOPE_').length === 0);
    st.apply(P(t3.raw), 2000);
    st.apply(P(t4.raw), 2001);
    check('State stores group keys as GROUP.KEY', st.num('CAL_GYRO_OFFSET.X') === 0.1234 && st.num('CAL_GYRO_OFFSET.SAMPLES') === 300 && st.get('TM_STREAM.SUN') === 'ON' && st.get('X') === undefined);
    const ack0 = st.lastAck;
    st.apply(P('ERR,RW_INVALID_OR_RANGE'), 3000);
    st.apply(P('ACK,RW,30.0'), 3001);
    check('State keeps the last ACK and the last ERR', ack0.cmd === 'STATUS' && st.lastErr.code === 'RW_INVALID_OR_RANGE' && st.lastErr.t === 3000 && st.lastAck.cmd === 'RW' && st.lastAck.args[0] === '30.0');
    const se = new NS.ss.State({ maxEvents: 5 });
    for (let i = 0; i < 12; i++) se.apply(P(`EVT,E${i},${i}`), i);
    check('State keeps a bounded list of events, newest last', se.events.length === 5 && se.events[0].name === 'E7' && se.events[4].name === 'E11' && se.events[4].args[0] === '11');
    const sb = new NS.ss.State();
    [P('SUNSEEK PLATFORM v2.1 — Training Firmware'), P('Spacecraft ID: SUNSEEK-Team_DekMUT'), P('PONG'), P('TM,HELP,a,b'), P('PAYLOAD,EVENT,CAPTURE_STARTED')].forEach((p, i) => sb.apply(p, 10 + i));
    check('State notes the banner, spacecraft id, last PONG, help text and payload line', sb.banner.startsWith('SUNSEEK PLATFORM v2.1') && sb.spacecraftId === 'SUNSEEK-Team_DekMUT' && sb.lastPong === 12 && sb.help[0] === 'a,b' && sb.lastPayload.sub === 'EVENT');
    {
      const sg = new NS.ss.State({ maxKeys: 3 });
      let ok = true;
      try { sg.apply(null); sg.apply({}); sg.apply({ kind: 'tm' }); sg.apply({ kind: 'ack' }); sg.apply(P('TM,A,1,B,2,C,3,D,4'), 1); } catch (_) { ok = false; }
      check('State.apply never throws on junk and caps the number of keys', ok && sg.nKeys === 3 && sg.get('D') === undefined && sg.get('A') === '1');
      sg.clear();
      check('State.clear forgets everything', sg.lines === 0 && sg.get('A') === undefined && sg.lastAck === null && sg.events.length === 0);
    }
    check('errHelp: Thai fix for an ERR code (also behind "ERR code detail"); nothing for NasaSat or unknown text', NS.ss.errHelp('ERR RW_REQUIRES_REACTION_STRATEGY').includes('ADCS_STRATEGY,REACTION') && NS.ss.errHelp('ERR ADCS_PREPARE GYRO_NOT_READY').includes('ไจโร') && NS.ss.errHelp('ERR,UNKNOWN_COMMAND').includes('HELP') && NS.ss.errHelp('@3 ERR RANGE ctl.k 0.1..1.5') === '' && NS.ss.errHelp('constructor __proto__ toString') === '' && NS.ss.errHelp('') === '' && NS.ss.errHelp(null) === '');

    // ---- Client with a fake board that answers like the firmware (same strings as System_CommandRouter.h) ----
    const board = (o = {}) => {
      const b = { sent: [], mode: 'MANUAL', strategy: 'REACTION', failWith: null, client: null };
      const answer = (c) => {
        if (c === 'PING') return ['PONG'];
        if (c === 'STATUS') return status;
        if (c === 'HELP') return ['TM,HELP,PAYLOAD_STATUS|PAYLOAD_PING|CAPTURE', 'TM,HELP,ADCS_MODE,MANUAL|AUTO', 'TM,HELP,ADCS_REFERENCE,SUN|MAG|SET_TARGET,<deg>', 'TM,HELP,ADCS_STRATEGY,REACTION|MOMENTUM|ADCS_TUNE,<Kp>,<Kd>,<Bias>', 'TM,HELP,RW,<cmd>|RW_BIAS,<bias>|STATUS|STOP|SENSOR_STATUS', 'TM,HELP,ESTIMATOR_STATUS'];
        if (c === 'GYRO_RAW') return ['TM,RAW_GX,12,RAW_GY,-3,RAW_GZ,7', 'TM,GYRO_Z,0.123'];
        if (c === 'STOP') { b.mode = 'MANUAL'; return ['ACK,STOP', 'EVT,SAFE']; }
        if (c === 'ADCS_MODE,AUTO') { b.mode = 'AUTO'; return ['ACK,ADCS_MODE,AUTO', status[2]]; }
        if (c === 'ADCS_MODE,MANUAL') { b.mode = 'MANUAL'; return ['ACK,ADCS_MODE,MANUAL', status[2]]; }
        if (c === 'ADCS_STRATEGY,MOMENTUM' || c === 'ADCS_STRATEGY,REACTION') { b.strategy = c.slice(14); return ['ACK,' + c, 'TM,RW_CMD,0,RW_BIAS,0,RW_STATE,STOPPED']; }
        if (c === 'TM_STREAM,ALL,ON' || c === 'TM_STREAM,QUIET') return ['ACK,' + c];
        if (c === 'ADCS_TUNE,2,0.5,40') return ['ACK,ADCS_TUNE,2.000,0.500,40', status[2]];
        if (c.split(',')[0] === 'RW') {
          if (b.mode === 'AUTO') return ['ERR,MANUAL_RW_COMMAND_REQUIRES_MANUAL_MODE'];
          if (b.strategy !== 'REACTION') return ['ERR,RW_REQUIRES_REACTION_STRATEGY'];
          const v = +c.slice(3);
          if (!(v >= -100 && v <= 100)) return ['ERR,RW_INVALID_OR_RANGE'];
          return ['ACK,RW,' + v.toFixed(1), 'TM,RW_CMD,' + Math.round(v) + ',RW_BIAS,0,RW_STATE,REACTION_DRIVE'];
        }
        if (c === 'NOREPLY') return [];
        return ['ERR,UNKNOWN_COMMAND'];
      };
      b.write = (line) => {
        b.sent.push(line);
        if (b.failWith === 'throw') throw new Error('port closed');
        if (b.failWith === 'reject') return Promise.reject(new Error('port closed'));
        const go = () => { for (const l of answer(NS.ss.norm(line))) b.client.feed(l); };
        if (o.sync) go(); else setTimeout(go, 1);
        return undefined;
      };
      b.client = new NS.ss.Client(b, o.client || {});
      return b;
    };
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    {
      const b = board();
      check('Client: default timeout 1500 ms, own State; the options override it', b.client.timeout === 1500 && b.client.state instanceof NS.ss.State && new NS.ss.Client(b, { timeout: 77 }).timeout === 77);
      const ps = [b.client.send('PING'), b.client.send('STATUS'), b.client.send('HELP')];
      check('Client: one command in flight, the others wait (only PING written so far)', b.sent.join() === 'PING' && b.client.waiting === 3);
      const rs = await Promise.all(ps);
      check('Client queue: commands go out in order, each one only after the previous completed', b.sent.join() === 'PING,STATUS,HELP' && rs.every((r) => r.ok), JSON.stringify(rs.map((r) => r.ok)));
      check('Client: PING -> PONG, STATUS -> its ACK, HELP -> the first TM,HELP line', rs[0].reply.kind === 'pong' && rs[1].reply.raw === 'ACK,STATUS' && rs[2].reply.kind === 'help');
      await wait(15);
      check('Client: every line reaches the State, also the lines after the one that completed the command', b.client.state.get('RW_STATE') === 'STOPPED' && b.client.state.get('SENSOR_GYRO') === 'READY' && b.client.state.help.length === 6 && b.client.state.lastPong > 0, `help lines ${b.client.state.help.length}`);
    }
    {
      const b = board();
      let r = await b.client.send('ADCS_STRATEGY,MOMENTUM');
      r = await b.client.send('RW,30');
      check('Client: ERR while in flight -> not ok, reply is the ERR (RW in MOMENTUM strategy), no timeout flag', r.ok === false && !r.timeout && r.reply.err.code === 'RW_REQUIRES_REACTION_STRATEGY', JSON.stringify(r.reply && r.reply.err));
      r = await b.client.send('ADCS_STRATEGY,REACTION');
      check('Client: ACK,ADCS_STRATEGY,REACTION answers ADCS_STRATEGY,REACTION', r.ok && r.reply.ack.cmd === 'ADCS_STRATEGY');
      r = await b.client.send('RW,30');
      check('Client: ACK,RW,30.0 answers RW,30 (and the TM after it updates the State)', r.ok && r.reply.raw === 'ACK,RW,30.0' && b.client.state.get('RW_STATE') === 'REACTION_DRIVE' && b.client.state.num('RW_CMD') === 30);
      r = await b.client.send('RW,  250');
      check('Client: RW out of range -> ERR,RW_INVALID_OR_RANGE (spaces around commas are the board\'s business)', !r.ok && r.reply.err.code === 'RW_INVALID_OR_RANGE');
      r = await b.client.send('ADCS_MODE,AUTO');
      const rAuto = await b.client.send('RW,10');
      check('Client: AUTO mode refuses the wheel with ERR,MANUAL_RW_COMMAND_REQUIRES_MANUAL_MODE', r.ok && !rAuto.ok && rAuto.reply.err.code === 'MANUAL_RW_COMMAND_REQUIRES_MANUAL_MODE');
      r = await b.client.send('STOP');
      check('Client: STOP -> ACK,STOP (the EVT,SAFE after it goes to the State)', r.ok && r.reply.ack.cmd === 'STOP' && b.mode === 'MANUAL' && b.client.state.events.length === 1 && b.client.state.events[0].name === 'SAFE');
      r = await b.client.send('TM_STREAM,ALL,ON');
      const rQuiet = await b.client.send('TM_STREAM,QUIET');
      const rTune = await b.client.send('ADCS_TUNE, 2 ,0.5, 40');
      check('Client: TM_STREAM,ALL,ON / TM_STREAM,QUIET / ADCS_TUNE complete on their ACK (cmd = first token)', r.ok && rQuiet.ok && rTune.ok && rTune.reply.ack.args.join() === '2.000,0.500,40');
      r = await b.client.send('BOGUS');
      check('Client: unknown command -> ERR,UNKNOWN_COMMAND -> not ok', !r.ok && r.reply.err.code === 'UNKNOWN_COMMAND');
    }
    {
      // other lines in between (a late ACK of another command, PONG, TM, EVT) must not complete a command
      const b = board();
      b.write = ((orig) => (line) => {
        if (line === 'RW,10') { b.sent.push(line); setTimeout(() => { for (const l of ['ACK,STOP', 'PONG', 'TM,SUN_L,1,SUN_R,2', 'EVT,SAFE', 'ACK,RW,10.0']) b.client.feed(l); }, 1); return undefined; }
        if (line === 'STATUS') { b.sent.push(line); setTimeout(() => { for (const l of ['PONG', 'ACK,PING', 'ACK,STATUS']) b.client.feed(l); }, 1); return undefined; }
        return orig(line);
      })(b.write);
      const r = await b.client.send('RW,10');
      check('Client: stray ACK,STOP / PONG / TM / EVT before the right ACK are ignored; it completes on ACK,RW,10.0', r.ok && r.reply.raw === 'ACK,RW,10.0' && b.client.state.lastAck.cmd === 'RW');
      const r2 = await b.client.send('STATUS');
      check('Client: PONG and ACK,PING do not complete STATUS', r2.ok && r2.reply.raw === 'ACK,STATUS');
    }
    {
      const b = board();
      const r = await b.client.send('GYRO_RAW');
      check('Client: GYRO_RAW has no ACK, so the first TM line completes it', r.ok && r.reply.kind === 'tm' && r.reply.tm.num.RAW_GX === 12, JSON.stringify(r.reply));
      await wait(10);
      check('Client: the second TM line of that reply still reached the State', b.client.state.num('GYRO_Z') === 0.123);
      check('Client: the readers without ACK are HELP, GYRO_RAW, MAG_RAW, SUN_RAW, TM_STREAM_STATUS, MISSION_STATUS', ['HELP', 'GYRO_RAW', 'MAG_RAW', 'SUN_RAW', 'TM_STREAM_STATUS', 'MISSION_STATUS'].every((c) => NS.ss.NO_ACK.has(c)) && NS.ss.NO_ACK.size === 6 && !NS.ss.NO_ACK.has('STATUS') && !NS.ss.NO_ACK.has('PING'));
    }
    {
      const b = board();
      const t0 = Date.now();
      const r = await b.client.send('NOREPLY', { timeout: 40 });
      check('Client: no reply -> { ok: false, timeout: true } after the timeout', r.ok === false && r.timeout === true && r.reply === null && Date.now() - t0 >= 35 && Date.now() - t0 < 400, `${Date.now() - t0} ms`);
      const r2 = await b.client.send('PING');
      check('Client: the queue goes on after a timeout', r2.ok && b.client.waiting === 0);
      const b3 = board({ client: { timeout: 30 } });
      const rs = await Promise.all([b3.client.send('NOREPLY'), b3.client.send('NOREPLY'), b3.client.send('PING')]);
      check('Client: the constructor timeout applies to each command; a timeout does not block the next one', rs[0].timeout && rs[1].timeout && rs[2].ok && b3.sent.join() === 'NOREPLY,NOREPLY,PING');
    }
    {
      const b = board({ sync: true }); // the board answers inside write()
      const first = b.client.send('NOREPLY', { timeout: 20 });
      const rest = [b.client.send('PING'), b.client.send('STATUS'), b.client.send('RW,5'), b.client.send('PING')];
      const rs = await Promise.all([first, ...rest]);
      check('Client: a transport that answers inside write() still completes the queue in order', b.sent.join() === 'NOREPLY,PING,STATUS,RW,5,PING' && rs.map((r) => r.ok).join() === 'false,true,true,true,true', rs.map((r) => r.ok).join());
    }
    {
      const b = board();
      b.failWith = 'throw';
      const r1 = await b.client.send('PING');
      b.failWith = 'reject';
      const r2 = await b.client.send('PING');
      b.failWith = null;
      const r3 = await b.client.send('PING');
      check('Client: a write that throws or rejects -> { ok: false, error }, no hang, the next command works', !r1.ok && r1.error === 'port closed' && !r2.ok && r2.error === 'port closed' && r3.ok);
      const before = b.sent.length;
      const bad = await Promise.all([b.client.send(''), b.client.send('   '), b.client.send(null), b.client.send('A'.repeat(241)), b.client.send('PING\nSTOP')]);
      check('Client: empty / longer than 240 / multi-line commands are refused without writing', bad.every((x) => !x.ok && x.error) && b.sent.length === before, bad.map((x) => x.error).join());
      const edge = await b.client.send('X'.repeat(240));
      check('Client: a command of exactly 240 characters is written', b.sent.length === before + 1 && !edge.ok && edge.reply.err.code === 'UNKNOWN_COMMAND');
    }
    {
      const b = board();
      const p1 = b.client.send('NOREPLY', { timeout: 5000 });
      const p2 = b.client.send('PING');
      const sn = await b.client.sendNow('STOP');
      check('Client.sendNow goes straight to the board, past the command in flight (for STOP)', sn.ok && b.sent.join() === 'NOREPLY,STOP' && b.client.waiting === 2);
      await wait(10);
      b.client.abort('การเชื่อมต่อปิด');
      const [a1, a2] = await Promise.all([p1, p2]);
      check('Client.abort ends the command in flight and everything queued (not ok, aborted); nothing is left', !a1.ok && a1.aborted && !a2.ok && a2.aborted && a2.error === 'การเชื่อมต่อปิด' && b.client.waiting === 0);
      await wait(20);
      const r = await b.client.send('PING');
      check('Client works again after abort', r.ok);
      b.failWith = 'throw';
      check('Client.sendNow reports a failed write instead of throwing', (await b.client.sendNow('STOP')).ok === false);
    }
  }
  // ---- Web Bluetooth transport (03b_ble.js) with a fake device / characteristics ----
  console.log('bluetooth transport (Nordic UART, fake GATT)');
  {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const enc = new TextEncoder();
    const dv = (s) => { const u = typeof s === 'string' ? enc.encode(s) : Uint8Array.from(s); return new DataView(u.buffer, u.byteOffset, u.byteLength); };
    // a board on the other side of the radio: writes land in `got`, notify() sends what the board says
    const mkBle = (o = {}) => {
      const f = { writes: [], concurrent: 0, maxConcurrent: 0, connects: 0, req: null, failConnect: 0, listeners: {}, devL: {}, started: 0, stopped: 0, writeFail: null };
      const tx = {
        addEventListener: (t, fn) => { f.listeners[t] = fn; },
        removeEventListener: (t, fn) => { if (f.listeners[t] === fn) delete f.listeners[t]; },
        startNotifications: async () => { f.started++; },
        stopNotifications: async () => { f.stopped++; },
      };
      const write = async (v) => {
        f.concurrent++; f.maxConcurrent = Math.max(f.maxConcurrent, f.concurrent);
        await wait(2); // a GATT write takes time; a second one now would be refused by Chrome
        f.concurrent--;
        if (f.writeFail) { const e = f.writeFail; if (e.once) f.writeFail = null; throw e.err; }
        f.writes.push(Uint8Array.from(new Uint8Array(v.buffer ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v)));
      };
      const rx = o.noResp ? { writeValue: write } : { writeValueWithResponse: write, writeValue: write };
      const svc = { getCharacteristic: async (u) => { if (u === NS.BLE.RX) return rx; if (u === NS.BLE.TX) return tx; throw Object.assign(new Error('no such characteristic'), { name: 'NotFoundError' }); } };
      const server = {
        connected: false,
        getPrimaryService: async (u) => { if (u !== NS.BLE.SERVICE) throw Object.assign(new Error('no service'), { name: 'NotFoundError' }); return svc; },
      };
      const device = {
        name: 'SUNSEEK-NasaPakSoi', id: 'abc',
        addEventListener: (t, fn) => { f.devL[t] = fn; },
        removeEventListener: (t, fn) => { if (f.devL[t] === fn) delete f.devL[t]; },
        gatt: {
          get connected() { return server.connected; },
          connect: async () => { f.connects++; await wait(1); if (f.failConnect > 0) { f.failConnect--; throw Object.assign(new Error('GATT Error: Connection attempt failed.'), { name: 'NetworkError' }); } server.connected = true; return server; },
          disconnect: () => { if (!server.connected) return; server.connected = false; if (f.devL.gattserverdisconnected) f.devL.gattserverdisconnected({ target: device }); },
        },
      };
      f.device = device; f.server = server;
      f.bluetooth = { requestDevice: async (opt) => { f.req = opt; return device; } };
      f.notify = (x) => { if (f.listeners.characteristicvaluechanged) f.listeners.characteristicvaluechanged({ target: { value: dv(x) } }); };
      f.drop = () => { server.connected = false; if (f.devL.gattserverdisconnected) f.devL.gattserverdisconnected({ target: device }); }; // the board went away
      f.text = () => new TextDecoder().decode(Uint8Array.from(f.writes.flatMap((w) => [...w])));
      return f;
    };
    const make = (f, extra = {}) => {
      const tr = new NS.BleTransport({ bluetooth: f.bluetooth, ...extra });
      tr.got = []; tr.status = [];
      tr.onLine = (l) => tr.got.push(l);
      tr.onStatus = (s, i) => tr.status.push([s, i]);
      return tr;
    };

    // pure helpers
    const lb = new NS.LineBuffer();
    check('LineBuffer: one line per notification (the board adds "\\n")', lb.push(enc.encode('TM,SENSOR_SUN,READY\n')).join('|') === 'TM,SENSOR_SUN,READY');
    check('LineBuffer: a line cut into pieces comes out whole, once', (() => { const a = lb.push('TM,TEAM_C,T,12'); const b = lb.push('34,M,1,TGT'); const c = lb.push(',0\n'); return a.length === 0 && b.length === 0 && c.join('|') === 'TM,TEAM_C,T,1234,M,1,TGT,0'; })());
    check('LineBuffer: several lines in one notification, "\\r\\n" and empty lines handled', lb.push(enc.encode('ACK,STOP\r\n\r\nPONG\nEVT,SAFE')).join('|') === 'ACK,STOP|PONG' && lb.push('\n').join('|') === 'EVT,SAFE');
    check('LineBuffer: a Thai character split between two notifications is decoded whole (DataView input too)', (() => { const b = enc.encode('PAYLOAD,ก\n'); const l = new NS.LineBuffer(); const a = l.push(dv([...b.slice(0, 10)])); const c = l.push(dv([...b.slice(10)])); return a.length === 0 && c.join('|') === 'PAYLOAD,ก'; })());
    check('LineBuffer: a stream that never ends a line is cut at the limit', (() => { const l = new NS.LineBuffer(100); l.push('x'.repeat(150)); return l.buf.length === 0 && l.push('PONG\n').join() === 'PONG'; })());
    const ch = NS.bleChunks(enc.encode('A'.repeat(240) + '\n'), 100);
    check('bleChunks: 241 bytes -> 100 + 100 + 41, none empty, concatenation is the original', ch.length === 3 && ch.map((c) => c.length).join() === '100,100,41' && ch.flatMap((c) => [...c]).join() === [...enc.encode('A'.repeat(240) + '\n')].join());
    check('bleChunks: a short line is one piece; exactly 100 bytes is one piece; nothing -> no pieces', NS.bleChunks(enc.encode('PING\n')).length === 1 && NS.bleChunks(new Uint8Array(100)).length === 1 && NS.bleChunks(new Uint8Array(0)).length === 0 && NS.bleChunks(new Uint8Array(101)).length === 2);

    // connect
    {
      const f = mkBle();
      const tr = make(f);
      const info = await tr.connect();
      check('connect: chooser filtered by name prefix SUNSEEK, Nordic UART service requested, notifications on, status open with the name',
        f.req.filters.length === 1 && f.req.filters[0].namePrefix === 'SUNSEEK' && f.req.optionalServices[0] === '6e400001-b5a3-f393-e0a9-e50e24dcca9e' && !f.req.acceptAllDevices && f.started === 1 && tr.keep && tr.kind === 'ble' && tr.status[0][0] === 'open' && info.name === 'SUNSEEK-NasaPakSoi');
      const f2 = mkBle();
      await make(f2).connect({ all: true });
      check('connect with "show all devices": acceptAllDevices and still the service in optionalServices', f2.req.acceptAllDevices === true && !f2.req.filters && f2.req.optionalServices.length === 1);
      check('UUIDs are the ones of the board (service, RX we write, TX it notifies)', NS.BLE.RX === '6e400002-b5a3-f393-e0a9-e50e24dcca9e' && NS.BLE.TX === '6e400003-b5a3-f393-e0a9-e50e24dcca9e');

      // notifications -> onLine
      f.notify('PONG\n');
      f.notify('TM,TEAM_C,T,100,M,1,TGT,0,ANG,-5.2\nACK,STOP\r\n');
      f.notify('EVT,TEAM_KICK,12');
      f.notify(',ERR,3.4\n');
      f.notify('\n');
      check('notifications become lines (onLine), cut / merged / empty ones handled', tr.got.join('|') === 'PONG|TM,TEAM_C,T,100,M,1,TGT,0,ANG,-5.2|ACK,STOP|EVT,TEAM_KICK,12,ERR,3.4', tr.got.join('|'));
      tr.onLine = () => { throw new Error('ui bug'); };
      let threw = false;
      const ce = console.error;
      console.error = () => {};
      try { f.notify('PONG\n'); f.notify('PONG\n'); } catch (_) { threw = true; }
      console.error = ce;
      check('a handler that throws does not stop the reading', !threw);
      tr.onLine = (l) => tr.got.push(l);

      // writes
      const long = 'TEAM_LUT_DATA,0,' + '1.234,'.repeat(40);
      const w1 = tr.write('PING');
      const w2 = tr.write(long.slice(0, 240));
      const w3 = tr.write('STOP');
      await Promise.all([w1, w2, w3]);
      check('write: every line + "\\n" reaches the RX characteristic in order (even when three are queued at once)', f.text() === 'PING\n' + long.slice(0, 240) + '\nSTOP\n', JSON.stringify(f.text().slice(0, 40)));
      check('write: pieces are at most 100 bytes, never two GATT writes at the same time', f.writes.every((w) => w.length <= 100) && f.maxConcurrent === 1 && f.writes.length === 1 + 3 + 1, `${f.writes.map((w) => w.length)} max concurrent ${f.maxConcurrent}`);
      check('write: the 240-character command is cut as 100 + 100 + 41', f.writes.slice(1, 4).map((w) => w.length).join() === '100,100,41');

      // a failing write rejects, the chain goes on
      f.writeFail = { once: true, err: Object.assign(new Error('GATT operation failed for unknown reason.'), { name: 'NetworkError' }) };
      let failed = false;
      await tr.write('RW,10').catch(() => { failed = true; });
      await tr.write('RW,0');
      check('write: a failed write rejects its own promise, the next line still goes out', failed && f.text().endsWith('RW,0\n'));
      f.writeFail = { once: true, err: Object.assign(new Error('GATT operation already in progress.'), { name: 'NetworkError' }) };
      const before = f.writes.length;
      await tr.write('TEAM_GET,adcs.kp');
      check('write: "GATT operation already in progress" is retried, the line is sent once', f.writes.length === before + 1 && f.text().endsWith('TEAM_GET,adcs.kp\n'));

      // our own close is not a loss
      const st0 = tr.status.length;
      await tr.disconnect();
      check('disconnect: status closed (never lost), notifications unhooked, link down, write refused afterwards', tr.status.slice(st0).map((s) => s[0]).join() === 'closed' && !tr.keep && !f.server.connected && !f.listeners.characteristicvaluechanged && (await tr.write('PING').then(() => false, () => true)));
    }
    {
      const f = mkBle({ noResp: true });
      const tr = make(f);
      await tr.connect();
      await tr.write('STOP');
      check('write falls back to writeValue when writeValueWithResponse does not exist', f.text() === 'STOP\n');
    }
    {
      const f = mkBle();
      const tr = make(f);
      await tr.connect();
      let n = 0;
      tr.rx.writeValueWithResponse = async () => { n++; throw Object.assign(new Error('not supported'), { name: 'NotSupportedError' }); };
      await tr.write('STOP');
      await tr.write('PING');
      check('write falls back to writeValue after writeValueWithResponse is refused (and stays there)', n === 1 && f.text() === 'STOP\nPING\n' && tr.noResp === true);
    }

    // link lost, reconnect without the chooser
    {
      const f = mkBle();
      const tr = make(f);
      await tr.connect();
      f.drop();
      check('gattserverdisconnected -> status lost (once), keep false, write refused', tr.status.map((s) => s[0]).join() === 'open,lost' && !tr.keep && (await tr.write('PING').then(() => false, () => true)));
      f.drop();
      check('a second gattserverdisconnected while already lost is ignored', tr.status.length === 2);
      f.failConnect = 2;
      const req0 = f.req;
      const info = await tr.reconnect({ ms: 5000, every: 5 });
      check('reconnect: retries gatt.connect on the same device (no chooser), 2 failures then open again with notifications and writes working',
        f.req === req0 && f.connects === 4 && tr.keep && tr.status[tr.status.length - 1][0] === 'open' && info.name === 'SUNSEEK-NasaPakSoi', `connects ${f.connects}`);
      f.notify('PONG\n');
      await tr.write('PING');
      check('after the reconnect lines arrive and writes go out', tr.got.pop() === 'PONG' && f.text().endsWith('PING\n') && f.started === 2);
      f.drop();
      check('and a loss after the reconnect is reported again', tr.status[tr.status.length - 1][0] === 'lost');
    }
    {
      const f = mkBle();
      const tr = make(f);
      await tr.connect();
      f.drop();
      f.failConnect = 1000;
      let err = null;
      const t0 = Date.now();
      await tr.reconnect({ ms: 80, every: 10 }).catch((e) => { err = e; });
      check('reconnect gives up after the time limit with the last error, nothing left half open', !!err && Date.now() - t0 < 600 && !tr.keep && !tr.rx && f.connects > 3, err && err.message);
      let stopAt = 0;
      f.connects = 0;
      const t1 = Date.now();
      await tr.reconnect({ ms: 5000, every: 10, stop: () => ++stopAt > 3 }).catch(() => {});
      check('reconnect stops at once when the user closes the link (stop() = true)', Date.now() - t1 < 500 && f.connects <= 3);
      f.failConnect = 0;
      const f2 = mkBle();
      const tr2 = make(f2);
      await tr2.connect();
      f2.server.getPrimaryService = async () => { throw Object.assign(new Error('Service not found'), { name: 'NotFoundError' }); };
      f2.drop();
      let e2 = null;
      await tr2.reconnect({ ms: 40, every: 5 }).catch((e) => { e2 = e; });
      check('a device without the Nordic UART service: the attempt fails and the GATT link is closed again', !!e2 && !f2.server.connected && !tr2.keep);
    }
    {
      const f = mkBle();
      const tr = make(f);
      f.bluetooth.requestDevice = async () => { throw Object.assign(new Error('User cancelled the requestDevice() chooser.'), { name: 'NotFoundError' }); };
      const e = await tr.connect().then(() => null, (x) => x);
      check('cancelling the chooser rejects (the app ignores "cancel"), nothing is open', e && /cancel/i.test(e.message) && !tr.keep && tr.status.length === 0);
      check('bleErrHelp: cancel -> no hint, no adapter / connection failure / wrong device -> Thai hint', NS.bleErrHelp(e) === '' && NS.bleErrHelp(new Error('Bluetooth adapter not available.')).includes('Bluetooth') && NS.bleErrHelp(Object.assign(new Error('GATT Error: Connection attempt failed.'), { name: 'NetworkError' })).includes('Ground Station') && NS.bleErrHelp(Object.assign(new Error('Service not found'), { name: 'NotFoundError' })).includes('SUNSEEK'));
    }

    // the SunSeek client over the Bluetooth transport: the same commands, the same replies
    {
      const f = mkBle();
      const tr = make(f);
      const client = new NS.ss.Client(tr, { timeout: 500 });
      tr.onLine = (l) => client.feed(l);
      await tr.connect();
      const answer = async () => { // the "firmware": answers every complete line it has received
        let done = 0;
        const timer = setInterval(() => {
          const lines = f.text().split('\n').slice(0, -1);
          for (; done < lines.length; done++) {
            const c = lines[done];
            if (c === 'PING') f.notify('PONG\n');
            else if (c === 'TEAM_CSTREAM,10') f.notify('ACK,TEAM_CSTREAM,10\n');
            else if (c.startsWith('TEAM_SET,')) f.notify('ACK,' + c + '\n');
          }
        }, 3);
        return () => clearInterval(timer);
      };
      const stopAnswer = await answer();
      const r1 = await client.send('PING');
      const r2 = await client.send('TEAM_CSTREAM,10');
      const r3 = await client.send('TEAM_SET,adcs.kp,2.5');
      const r4 = await client.send('NOREPLY', { timeout: 60 });
      stopAnswer();
      check('Client over Bluetooth: PING -> PONG, TEAM_CSTREAM -> ACK, TEAM_SET -> ACK, a silent command times out', r1.ok && r2.ok && r2.reply.ack.args[0] === '10' && r3.ok && r4.timeout === true);
      const sn = await client.sendNow('STOP');
      check('Client.sendNow (STOP) works over Bluetooth too', sn.ok && f.text().endsWith('STOP\n'));
      await tr.disconnect();
    }
  }
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
