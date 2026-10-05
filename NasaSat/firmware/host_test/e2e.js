// End-to-end test of the REAL firmware (compiled for the PC by build.js) inside the simulated world.
// It drives the board the way the web tool does - same parser, same fit, same "push" lines, same image
// assembler (tool/src/js) - and grades every result against the world's hidden truth.
// usage:  node build.js && node e2e.js            (add --core2 to test the core-2.x build, --verbose for all lines)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NS, Board, isJ, isE, okOf, errOf, jOf } = require('./harness');

const core2 = process.argv.includes('--core2');
const exe = path.join(__dirname, 'build', 'nasasat_host' + (core2 ? '_core2' : '') + (process.platform === 'win32' ? '.exe' : ''));

// ------------------------------------------------------------------ reporting
let passes = 0;
let fails = 0;
const failed = [];
const summary = [];
const check = (name, cond, info = '') => {
  if (cond) { passes++; console.log(`  ok   ${name} ${info}`); } else { fails++; failed.push(name); console.log(`  FAIL ${name} ${info}`); }
};
const section = (s) => console.log(`\n== ${s}`);
const note = (k, v) => { summary.push([k, v]); };
const f2 = (x, d = 2) => (NS.isNum(x) ? x.toFixed(d) : String(x));
const wrap180 = (a) => { let x = ((a + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };

// ------------------------------------------------------------------ the scenario
(async () => {
  if (!fs.existsSync(exe)) { console.log(`missing ${exe}: run  node build.js${core2 ? ' --core2' : ''}  first`); process.exitCode = 1; return; }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasasat-e2e-'));
  const B = new Board(exe, stateDir);
  const cfg = new Map();                // what the tool believes the board holds (from CFG LIST / SET replies)
  let lut = null;
  const setOk = async (k, v) => { const r = await B.cmd(`SET ${k} ${v}`); const ok = okOf(r)[0]; if (ok) cfg.set(k, Number(ok.text.split('=')[1])); return ok; };
  const raw = async (ms = 300) => { B.send(`RAW ${ms}`); const w = await B.until(isJ('raw'), ms + 2000, 100); return w.hit ? w.hit.json : { th: NaN, G: [NaN, NaN], valid: false }; };
  const waitProcEnd = async (name, seen = [], maxMs = 30000) => {
    const end = (m) => m.kind === 'e' && m.evt === 'PROC' && m.args[0] === name && (m.args[1] === 'END' || m.args[1] === 'ABORT');
    if (seen.some(end)) return true;
    return !!(await B.until(end, maxMs)).hit;
  };
  const waitIdle = async (maxMs = 30000) => { // until the actuator stops (telemetry MOVING flag clear twice)
    let calm = 0;
    for (let t = 0; t < maxMs; t += 100) {
      const got = await B.run(100);
      const tl = got.filter((m) => m.kind === 't');
      if (tl.length && !(tl[tl.length - 1].vals[10] & 2)) calm++; else calm = 0;
      if (calm >= 2) return true;
    }
    return false;
  };
  const move = async (line) => { await B.cmd(line); return waitIdle(); };

  // ---------------------------------------------------------------- boot
  section('boot + protocol');
  await B.start();
  const boot = await B.run(200);
  check('boot banner', boot.some((m) => m.kind === 'info' && m.text.includes('NasaSat firmware boot')));
  check('boot event POWERON', boot.some((m) => m.kind === 'e' && m.evt === 'BOOT' && m.args[0] === 'POWERON'));
  const hello = jOf(boot, 'hello')[0];
  check('hello json (proto 1, fw NasaSat)', hello && hello.proto === 1 && hello.fw === 'NasaSat', hello ? `${hello.board} v${hello.ver}` : '');
  const th = boot.find((m) => m.kind === 'th');
  check('telemetry header = tool TEL_COLS', th && th.cols.join(',') === NS.TEL_COLS.join(','), th ? th.cols.join(',') : 'missing');

  const cl = await B.cmd('CFG LIST', 100);
  const items = (jOf(cl, 'cfg')[0] || {}).items || [];
  for (const it of items) cfg.set(it.k, it.v);
  const defs = NS.CFG_DEFS;
  const mism = defs.filter((d) => { const it = items.find((x) => x.k === d.k); return !it || it.t !== d.t || it.v !== d.d || it.min !== d.min || it.max !== d.max || it.step !== d.step || it.sv !== d.d; });
  check('CFG LIST = tool registry (keys, types, defaults, ranges)', items.length === defs.length && !mism.length, `${items.length}/${defs.length} keys${mism.length ? ' mismatch: ' + mism.map((d) => d.k).join(',') : ''}`);
  check('CFG LIST OK count', okOf(cl).some((m) => m.text === String(defs.length)));
  check('NVS key names <= 15 chars', defs.every((d) => d.k.length <= 15));

  let r = await B.cmd('@5 SET ctl.k 5');
  check('SET out of range -> @5 ERR RANGE', errOf(r).some((m) => m.id === 5 && m.code === 'RANGE'), errOf(r).map((m) => m.raw).join(' | '));
  r = await B.cmd('SET ctl.nlock 2.6');
  check('SET int rounds', okOf(r).some((m) => m.text === 'ctl.nlock=3'));
  await B.cmd('SET ctl.nlock 3');
  r = await B.cmd('SET nope 1');
  check('SET unknown key -> ERR KEY', errOf(r).some((m) => m.code === 'KEY'));
  r = await B.cmd('SET ctl.k abc');
  check('SET non-number -> ERR VAL', errOf(r).some((m) => m.code === 'VAL'));
  r = await B.cmd('@9 GET est.alpha');
  check('GET with id', okOf(r).some((m) => m.id === 9 && m.text === 'est.alpha=30'));
  r = await B.cmd('get ctl.k');
  check('commands are case-insensitive', okOf(r).some((m) => m.text === 'ctl.k=0.85'));
  r = await B.cmd('FOO');
  check('unknown command -> ERR CMD', errOf(r).some((m) => m.code === 'CMD'));
  r = await B.cmd('SET ' + 'x'.repeat(3000));
  check('over-long line -> ERR LONG (and board keeps working)', errOf(r).some((m) => m.code === 'LONG'));
  r = await B.cmd('ï»¿HELLO');
  check('garbage/BOM before a command is ignored', okOf(r).length === 1 && !errOf(r).length);
  r = await B.cmd('HELP');
  check('HELP', r.filter((m) => m.kind === 'info').length >= 4 && okOf(r).length === 1);

  // GPIO rules: a pin wired to the flash, the PSRAM or the USB link is refused (after SAVE it would break every boot)
  r = await B.cmd('@31 SET act.in1 19');
  check('SET act.in1 19 (USB D-) -> ERR PIN', errOf(r).some((m) => m.id === 31 && m.code === 'PIN' && m.text.includes('USB')), errOf(r).map((m) => m.raw).join(' | '));
  r = await B.cmd('SET act.in1 27');
  check('SET act.in1 27 (SPI flash) -> ERR PIN', errOf(r).some((m) => m.code === 'PIN' && m.text.includes('flash')));
  r = await B.cmd('SET act.in2 35');
  check('SET act.in2 35 (octal PSRAM) -> ERR PIN', errOf(r).some((m) => m.code === 'PIN' && m.text.includes('PSRAM')));
  r = await B.cmd('SET act.spin 23');
  check('SET act.spin 23 (no such GPIO) -> ERR PIN', errOf(r).some((m) => m.code === 'PIN' && m.text.includes('no such')));
  r = await B.cmd('SET sen.pin0 38');
  check('SET sen.pin0 38 (not an ADC pin) -> ERR PIN', errOf(r).some((m) => m.code === 'PIN' && m.text.includes('ADC')));
  r = await B.cmd('GET act.in1');
  check('a refused pin is not stored', okOf(r).some((m) => m.text === 'act.in1=38'));
  r = await B.cmd('SET hw.sda -1');
  check('hw.sda -1 (= not used) is still accepted', okOf(r).some((m) => m.text === 'hw.sda=-1'));
  await B.cmd('SET hw.sda 8');
  r = await B.cmd('SET sen.pin1 1');
  check('two keys on one GPIO -> accepted with an E WARN PIN', okOf(r).some((m) => m.text === 'sen.pin1=1') && r.some((m) => m.kind === 'e' && m.evt === 'WARN' && m.args[0] === 'PIN' && m.args[1] === 'GPIO1'), r.filter((m) => m.kind === 'e').map((m) => m.raw).join(' | '));
  await B.cmd('SET sen.pin1 2');

  r = await B.run(1000);
  const tl = r.filter((m) => m.kind === 't');
  check('telemetry ~20 Hz, 11 columns', tl.length >= 18 && tl.length <= 22 && tl.every((m) => m.vals.length === 11 && m.vals.every(Number.isFinite)), `${tl.length} lines/s`);
  await B.cmd('STREAM OFF');
  r = await B.run(500);
  check('STREAM OFF stops telemetry', !r.some((m) => m.kind === 't'));
  r = await B.cmd('STREAM ON 10', 1000);
  check('STREAM ON 10 -> header + 10 Hz', r.some((m) => m.kind === 'th') && Math.abs(r.filter((m) => m.kind === 't').length - 10) <= 2);
  await B.cmd('STREAM ON 20');

  // ---------------------------------------------------------------- hardware discovery
  section('hardware discovery (PINFIND, wiring, direction)');
  r = await B.cmd('PINFIND ON', 450);
  const pins = jOf(r, 'pins');
  check('PINFIND streams ADC table', pins.length >= 2 && pins[0].mv['1'] > 500 && pins[0].mv['2'] > 500 && !('19' in pins[0].mv), pins.length ? `GPIO1=${pins[0].mv['1']} GPIO2=${pins[0].mv['2']} mV` : '');
  await B.cmd('PINFIND OFF');
  // motor wired to other pins than the defaults: nothing moves until act.in1..4 match
  await B.world('uln', '4,5,6,7');
  let t0 = await B.truth();
  await move('MOVE 10');
  let t1 = await B.truth();
  check('wrong ULN pins -> motor does not turn', t1.steps === t0.steps, `steps ${t1.steps - t0.steps}`);
  await move('MOVE -10'); // logical angle back to where the (unmoved) motor really is
  for (const [k, v] of [['act.in1', 4], ['act.in2', 5], ['act.in3', 6], ['act.in4', 7]]) await setOk(k, v);
  await move('GOTO 0');
  t0 = await B.truth();
  const a0 = await raw();
  await move('MOVE 10');
  t1 = await B.truth();
  const a1 = await raw();
  check('after SET act.in1..4 the motor turns ~10 deg', Math.abs(t1.body - t0.body - 10) < 1.2, `body ${f2(t0.body)} -> ${f2(t1.body)}`);
  check('direction check: MOVE +10 lowers the sun angle', a1.th < a0.th, `th ${f2(a0.th)} -> ${f2(a1.th)}`);
  await move('GOTO 0');
  // reversed coil order (IN1..IN4 mirrored) = opposite direction: detected by the same check, fixed with act.dir
  await B.world('wireDir', -1);
  const b0 = await raw();
  await move('MOVE 10');
  const b1 = await raw();
  check('reversed motor detected (th rises on MOVE +10)', b1.th > b0.th, `th ${f2(b0.th)} -> ${f2(b1.th)}`);
  await move('GOTO 0');
  await setOk('act.dir', -1);
  const c0 = await raw();
  await move('MOVE 10');
  const c1 = await raw();
  check('SET act.dir -1 fixes it', c1.th < c0.th, `th ${f2(c0.th)} -> ${f2(c1.th)}`);
  await move('GOTO 0');
  // back to the standard wiring for the rest
  await setOk('act.dir', 1);
  await B.world('wireDir', 1);
  for (const [k, v] of [['act.in1', 38], ['act.in2', 39], ['act.in3', 40], ['act.in4', 41]]) await setOk(k, v);
  await B.world('uln', '38,39,40,41');
  await move('GOTO 0');

  r = await B.cmd('HWID', 100);
  const hw = jOf(r, 'hwid')[0];
  check('HWID json', hw && hw.chip && hw.ldr_pins && hw.uln_pins && hw.fw.startsWith('NasaSat'), hw ? `${hw.chip} core ${hw.core} reset ${hw.reset}` : '');
  r = await B.cmd('HWID I2C', 400);
  const hw2 = jOf(r, 'hwid')[0];
  check('HWID I2C finds the device at 0x3C', hw2 && Array.isArray(hw2.i2c) && hw2.i2c.includes('0x3C'), hw2 ? JSON.stringify(hw2.i2c) : '');
  r = await B.cmd('DIAG', 100);
  check('DIAG json', (jOf(r, 'diag')[0] || { lines: [] }).lines.length >= 5);

  // ---------------------------------------------------------------- actuator calibration: SPR, BACKLASH
  section('actuator calibration (face the lamp, BACKLASH, then SPR with the gear play compensated)');
  B.send('M1 START 0');  // "face the lamp roughly" (BACKLASH looks for the zero crossing within +-5 deg)
  let u = await B.until(isE('M1', 'HOLD'), 30000, 100);
  await B.cmd('M1 STOP', 200);
  B.send('BACKLASH');
  u = await B.until(isJ('backlash'), 90000, 500);
  const bl = u.hit ? u.hit.json : null;
  check('BACKLASH measures gear play', bl && Math.abs(bl.deg - 1.4) < 0.35, bl ? `measured ${bl.deg} deg (truth 1.4) in ${(u.ms / 1000).toFixed(1)} s` : 'no result');
  note('backlash measured / truth', bl ? `${bl.deg} / 1.4 deg` : '-');
  await waitProcEnd('BACKLASH', u.lines);
  if (bl) await setOk('act.bl', bl.deg.toFixed(2));
  await setOk('act.max', 720);
  B.send('SPR');
  u = await B.until(isJ('spr'), 90000, 500);
  const spr = u.hit ? u.hit.json : null;
  const trueSpr = (await B.truth()).spr;
  check('SPR measures steps per output revolution', spr && Math.abs(spr.steps - trueSpr) <= 3 && !u.lines.some((m) => m.kind === 'e' && m.evt === 'WARN'), spr ? `measured ${spr.steps} (truth ${trueSpr}, cfg ${spr.cfg}) in ${(u.ms / 1000).toFixed(1)} s` : 'no result');
  note('SPR measured / truth', spr ? `${spr.steps} / ${trueSpr}` : '-');
  await waitProcEnd('SPR', u.lines);
  if (spr) await setOk('act.spr', spr.steps);
  await move('MOVE -360');
  await setOk('act.max', 170);
  // before the sensor calibration the reading is ~1.5x the real angle: with act.bl set every correction used to
  // jump over the target (the null seeker cycled forever in the same state); the gain now halves on a jump
  await move('GOTO -10');
  B.send('M1 START 0');
  u = await B.until(isE('M1', 'HOLD'), 30000, 100);
  check('M1 before the sensor calibration still settles (no endless overshoot)', !!u.hit, u.hit ? `HOLD after ${(u.ms / 1000).toFixed(1)} s (${u.hit.args.slice(1).join(' ')})` : 'no HOLD in 30 s');
  await B.cmd('M1 STOP', 200);

  // ---------------------------------------------------------------- sensor calibration exactly like the tool wizard
  section('sensor calibration (AMB -> SWEEP -> fit -> push -> validate)');
  await B.world('lampOn', 0);
  B.send('AMB 500');   // sent right after switching the lamp off (worst case for a slow LDR)
  u = await B.until(isJ('amb'), 8000);
  const amb = u.hit ? u.hit.json : null;
  note('AMB time (waits for the LDR to settle)', `${(u.ms / 1000).toFixed(1)} s`);
  const tAmb = await B.truth();
  const aTrue = Math.pow(tAmb.gL * 10000, 1 / 0.6); // what a perfectly settled measurement would give
  check('AMB right after lamp-off waits for the LDRs to settle (within 3 %)', amb && Math.abs(amb.aL / aTrue - 1) < 0.03, amb ? `aL=${amb.aL} (settled truth ${aTrue.toFixed(5)}) aR=${amb.aR}` : '');
  await B.world('lampOn', 1);
  const pts = [];
  B.send('SWEEP -60 60 5 300 cal');
  u = await B.until(isJ('sweep_end'), 120000, 500);
  for (const j of jOf(u.lines, 'sweep_pt')) pts.push({ ang: j.ang, mvL: j.mv[0], mvR: j.mv[1], GL: NS.est.toG(j.mv[0], 3300, 0), GR: NS.est.toG(j.mv[1], 3300, 0) });
  check('SWEEP 25 points', pts.length === 25, `${pts.length} pts in ${(u.ms / 1000).toFixed(1)} s`);
  const ambArg = (j) => (j ? { aL: j.aL, aR: j.aR, gamma: 0.6, GL: NS.est.toG(j.mv[0], 3300, 0), GR: NS.est.toG(j.mv[1], 3300, 0) } : null);
  let fit = NS.fit.fitPhysical(pts, { gamma: 0.6, alpha0: 30, fitQ: true, amb: ambArg(amb) });
  // two lamp brightnesses while facing the lamp (the team holds paper in front of the lamp): gammaR/gammaL makes
  // the estimator independent of the lamp brightness (audit 30 Sep, F04). Wait until the LDRs stop drifting.
  const stableRaw = async () => {
    let prev = null;
    for (let k = 0; k < 8; k++) {
      const j = await raw(1000);
      if (prev && Math.abs(j.G[0] / prev.G[0] - 1) < 0.003 && Math.abs(j.G[1] / prev.G[1] - 1) < 0.003) return { GL: (j.G[0] + prev.G[0]) / 2, GR: (j.G[1] + prev.G[1]) / 2, ang: j.ang };
      prev = j;
    }
    return null;
  };
  await move(`GOTO ${fit.P.phi.toFixed(1)}`);
  const lv1 = await stableRaw();
  await B.world('lampK', 0.4);
  const lv2 = await stableRaw();
  await B.world('lampK', 1);
  const ambC = amb ? { GL: NS.est.toG(amb.mv[0], 3300, 0), GR: NS.est.toG(amb.mv[1], 3300, 0) } : null;
  let gRatio = NaN;
  if (lv1 && lv2) {
    for (let it = 0; it < 3; it++) {
      gRatio = NS.fit.gammaRatio(lv1, lv2, ambC, fit.P.gL).ratio;
      fit = NS.fit.fitPhysical(pts, { gamma: 0.6, alpha0: 30, fitQ: true, amb: ambArg(amb), gRatio });
    }
  }
  check('gammaR/gammaL from two lamp brightnesses (paper over the lamp)', Math.abs(gRatio - 0.57 / 0.62) < 0.03, `${f2(gRatio, 4)} (truth ${f2(0.57 / 0.62, 4)}), stable readings ${lv1 && lv2 ? 'yes' : 'NO'}`);
  note('gammaR/gammaL measured / truth', `${f2(gRatio, 4)} / ${f2(0.57 / 0.62, 4)}`);
  const est = NS.fit.toEst(fit.P, { vcc: 3300, topo: 0 });
  const phi = fit.P.phi;
  const near = pts.filter((p) => Math.abs(phi - p.ang) < 12).map((p) => NS.est.estimate(p.GL, p.GR, { ...est, lutOn: 0 }).S);
  est.minS = +((near.length ? NS.median(near) : 1) * 0.15).toPrecision(3);
  const rng = NS.fit.range(pts, est, phi);
  if (rng) est.dmax = rng.dmax;
  est.lut = NS.fit.buildLUT(pts, est, phi, { dx: 1 });
  check('fit converged', fit.rms < 0.05, `rms ${f2(fit.rms, 4)} alpha ${f2(fit.P.alpha)} gamma L/R ${f2(fit.P.gL, 3)}/${f2(fit.P.gR, 3)} (truth 0.62/0.57) phi ${f2(phi)} range ${rng ? f2(rng.lo, 0) + '..' + f2(rng.hi, 0) : '-'}`);
  const e = est;
  const push = NS.fit.pushLines(e); // exactly what the tool's "send + SAVE" button sends
  let pushOk = 0;
  for (const l of push) { const rr = await B.cmd(l, 80); if (okOf(rr).length === 1) pushOk++; else console.log('     push failed:', l.slice(0, 60), rr.map((m) => m.raw).join(' | ')); }
  check('push calibration (tool pushLines) all OK', pushOk === push.length, `${pushOk}/${push.length} lines, LUT n=${e.lut ? e.lut.v.length : 0}, longest ${Math.max(...push.map((l) => l.length))} chars`);
  for (const l of push) if (l.startsWith('SET ')) { const [, k, v] = l.split(' '); cfg.set(k, Number(v)); }
  lut = e.lut;

  // estimator parity: firmware angle == tool angle for the same raw numbers
  const par = [];
  for (const a of [-30, -10, 0, 12, 33]) {
    await move(`GOTO ${a}`);
    const j = await raw(200);
    const p = NS.est.fromCfg((k, d) => (cfg.has(k) ? cfg.get(k) : d), lut);
    const js = NS.est.estimate(j.G[0], j.G[1], p);
    par.push(Math.abs(js.theta - j.th));
  }
  check('firmware estimator == tool estimator (same G -> same angle)', Math.max(...par) < 0.01, `max diff ${f2(Math.max(...par), 5)} deg`);

  // validation against the hidden truth, both approach directions, inside the usable range
  const validate = async () => {
    const errs = [];
    for (const a of [-38, 22, -12, 41, 4, -27, 31, 15, -3, 8, 0, 18, -20]) {
      await move(`GOTO ${a}`);
      const j = await raw(300);
      const tt = await B.truth();
      if (j.valid && rng && tt.theta > rng.lo + 2 && tt.theta < rng.hi - 2) errs.push(j.th - tt.theta);
    }
    return NS.fit.metrics(errs);
  };
  const mv0 = await validate();
  const spread = Math.sqrt(Math.max(0, mv0.rms ** 2 - mv0.mean ** 2));
  console.log(`     before the outside zero reference: MAE ${f2(mv0.mae, 3)} bias ${f2(mv0.mean, 3)} spread ${f2(spread, 3)} (n=${mv0.n}) <- sweep+fit alone cannot see this offset`);
  check('sweep+fit error is (almost) a pure offset (spread < 0.2 deg)', spread < 0.2, `spread ${f2(spread, 3)}`);
  note('angle bias left by sweep+fit alone', `${f2(mv0.mean, 3)} deg (spread ${f2(spread, 3)})`);
  // outside reference (sighting tube / protractor / camera centre): the team measures the true angle at one pose
  await move('GOTO 20');
  let tt = await B.truth();
  B.send(`CAL TH0 ${tt.theta.toFixed(2)}`);
  u = await B.until(isJ('th0'), 5000);
  check('CAL TH0 with an outside reference', !!u.hit, u.hit ? JSON.stringify(u.hit.json) : '');
  if (u.hit) cfg.set('est.th0', u.hit.json.new);
  await B.cmd('SAVE');
  const mv = await validate();
  check('calibrated angle vs truth (after CAL TH0): MAE < 0.3 deg', mv.mae < 0.3, `MAE ${f2(mv.mae, 3)} max ${f2(mv.max, 3)} bias ${f2(mv.mean, 3)} (n=${mv.n})`);
  note('sensor angle error vs truth after CAL TH0 (MAE / max)', `${f2(mv.mae, 3)} / ${f2(mv.max, 3)} deg`);

  // flicker: 20 ms windows cancel 100 Hz lamp flicker
  await B.world('flicker', 0.3);
  await move('GOTO 10');
  const fl = [];
  for (let i = 0; i < 6; i++) fl.push((await raw(60)).th);
  const sd = Math.sqrt(NS.mean(fl.map((x) => (x - NS.mean(fl)) ** 2)));
  check('30% lamp flicker: reading noise stays small (sd < 0.1 deg)', sd < 0.1, `sd ${f2(sd, 3)} deg`);
  await B.world('flicker', 0.08);

  // ---------------------------------------------------------------- mission 1
  section('mission 1 (sun tracking)');
  await move('GOTO -50');
  B.send('M1 START 0');
  u = await B.until(isE('M1', 'HOLD'), 30000, 100);
  let t = await B.truth();
  check('M1 locks on the lamp', !!u.hit && Math.abs(t.theta) < 0.6, `true error ${f2(t.theta, 3)} deg, lock after ${(u.ms / 1000).toFixed(1)} s (${u.hit ? u.hit.args.slice(1).join(' ') : 'no HOLD'})`);
  note('M1 from 75 deg off: true error / time', `${f2(t.theta, 3)} deg / ${(u.ms / 1000).toFixed(1)} s`);
  await B.run(3000);
  t = await B.truth();
  check('M1 holds (3 s later)', Math.abs(t.theta) < 0.6, `true error ${f2(t.theta, 3)}`);
  // an offset inside the HOLD band (past ctl.db, below ctl.hys: lamp nudged, cable pulling inside the gear play)
  // used to stay uncorrected for as long as M1 held; now it is trimmed, both directions, without leaving HOLD
  for (const dir of [1, -1]) {
    const lastT = B.all.filter((m) => m.kind === 't').pop();
    const e0 = lastT ? lastT.vals[4] : 0;
    const knock = dir > 0 ? e0 + 0.65 : e0 - 0.65; // board error after the knock = e0 - knock = -/+0.65 deg
    const tb = await B.truth();
    await B.world('bump', (tb.bump + knock).toFixed(3));
    u = await B.until((m) => m.kind === 'e' && m.evt === 'M1TRIM', 8000);
    const after = [...u.lines, ...(await B.run(1500))];
    const te = await B.truth();
    const tl10 = after.filter((m) => m.kind === 't').slice(-10); // one line = one 20 ms window: average the noise out
    const boardErr = tl10.length ? NS.mean(tl10.map((m) => m.vals[4])) : NaN;
    check(`${f2(knock)} deg knock while HOLD -> trimmed back, never leaves HOLD`,
      !!u.hit && !after.some(isE('M1', 'FINE')) && tl10.length && tl10[tl10.length - 1].vals[1] === 3 && Math.abs(boardErr) <= 0.3 && Math.abs(te.theta) < 0.6,
      `true error ${f2(tb.theta, 3)} -> knocked -> ${f2(te.theta, 3)}, board err (last 0.5 s) ${f2(boardErr, 3)} (${u.hit ? u.hit.raw : 'no trim'})`);
  }
  B.send('STEP 10');
  u = await B.until(isJ('step_result'), 20000);
  t = await B.truth();
  check('STEP 10 test -> step_result', !!u.hit && Math.abs(t.theta) < 0.6, u.hit ? `${JSON.stringify(u.hit.json)} true ${f2(t.theta, 3)}` : '');
  // somebody bumps the satellite
  await B.world('bump', 12);
  u = await B.until(isE('M1', 'HOLD'), 20000);
  t = await B.truth();
  check('bump 12 deg -> re-acquire + HOLD', !!u.hit && Math.abs(t.theta) < 0.6 && u.lines.some(isE('M1', 'FINE')), `true error ${f2(t.theta, 3)} in ${(u.ms / 1000).toFixed(1)} s`);
  // the lamp moves
  await B.world('lampAz', 55);
  u = await B.until(isE('M1', 'HOLD'), 20000);
  t = await B.truth();
  check('lamp moves 30 deg -> follows', !!u.hit && Math.abs(t.theta) < 0.6, `true error ${f2(t.theta, 3)} in ${(u.ms / 1000).toFixed(1)} s`);
  // lamp off -> LOST/SEARCH, on again at a new place -> found
  await B.world('lampOn', 0);
  u = await B.until(isE('M1', 'LOST'), 10000);
  check('lamp off -> LOST', !!u.hit);
  await B.world('lampAz', -35);
  await B.world('lampOn', 1);
  u = await B.until(isE('M1', 'HOLD'), 90000, 250);
  t = await B.truth();
  check('lamp back elsewhere -> found again -> HOLD', !!u.hit && Math.abs(t.theta) < 0.6, `true error ${f2(t.theta, 3)} after ${(u.ms / 1000).toFixed(1)} s${u.lines.some(isE('M1', 'SEARCH')) ? ' (via SEARCH)' : ' (still in view, no search needed)'}`);
  // offset target (mission may ask for a given angle to the light)
  B.send('M1 START 20');
  u = await B.until(isE('M1', 'HOLD'), 30000);
  t = await B.truth();
  check('M1 target 20 deg', !!u.hit && Math.abs(t.theta - 20) < 0.8, `true angle ${f2(t.theta, 3)}`);
  r = await B.cmd('M1 STOP', 200);
  check('M1 STOP -> IDLE', r.some(isE('M1', 'IDLE')));
  r = await B.cmd('STEP 5');
  check('STEP while not HOLD -> ERR STATE', errOf(r).some((m) => m.code === 'STATE'));
  // brightness change after calibration
  await B.world('lampAz', 25);
  await B.world('bump', 0);
  await B.world('lampK', 0.45);
  B.send('M1 START 0');
  u = await B.until(isE('M1', 'HOLD'), 30000);
  t = await B.truth();
  // Two different things: the sensor's own bias under a dimmer lamp (estimator), and where inside +-ctl.db M1
  // happened to stop (control). The old single check mixed both and passed or failed with the noise seed
  // (baseline code, seeds 1-4: 0.44 / 0.62 / 0.09 / 0.62 deg). The bias itself is finding F04, fixed in batch 1.
  const rawDim = await raw(300);
  const tDim = await B.truth();
  const biasDim = rawDim.th - tDim.theta;
  check('lamp 55% dimmer than at calibration -> sensor still within 0.3 deg of the truth (two-level gamma ratio)', !!u.hit && Math.abs(biasDim) < 0.3, `sensor bias ${f2(biasDim, 3)} deg (0.5 deg before the gamma ratio)`);
  check('... and M1 locked inside its deadband around that reading', !!u.hit && Math.abs(t.theta) <= Math.abs(biasDim) + cfg.get('ctl.db') + 0.15, `true pointing error ${f2(t.theta, 3)} deg = bias + lock position within +-ctl.db`);
  note('lamp x0.45 (F04): sensor bias / true pointing error', `${f2(biasDim, 3)} / ${f2(t.theta, 3)} deg`);
  await B.world('lampK', 1.9);
  u = await B.until(isE('M1', 'HOLD'), 20000);
  await B.run(2000);
  t = await B.truth();
  check('lamp 1.9x brighter -> still accurate', Math.abs(t.theta) < 0.6, `true error ${f2(t.theta, 3)}`);
  await B.world('lampK', 1);
  await B.cmd('M1 STOP', 200);

  // ---- the lamp starts behind the satellite: the old stop-wait-measure scan took 20-29 s (Sonnet audit F03)
  section('search with the lamp behind the satellite (continuous turn, first usable reading that M1 can reach)');
  for (const [lampAz, limit] of [[140, 8000], [-140, 15000]]) {
    await move('GOTO 0');
    await B.world('lampAz', lampAz);
    B.send('M1 START 0');
    u = await B.until(isE('M1', 'HOLD'), 40000, 100);
    t = await B.truth();
    check(`lamp at ${lampAz} deg (behind): SEARCH -> HOLD within ${limit / 1000} s, accurate`,
      !!u.hit && u.ms <= limit && Math.abs(t.theta) < 0.6 && u.lines.some(isE('M1', 'SEARCH')) && !u.lines.some((m) => m.kind === 'e' && m.evt === 'LIMIT'),
      `${(u.ms / 1000).toFixed(1)} s, true error ${f2(t.theta, 3)}${u.lines.some((m) => m.kind === 'e' && m.evt === 'LIMIT') ? ' (hit act.min/max!)' : ''}`);
    note(`search: lamp ${lampAz} deg behind -> HOLD`, `${(u.ms / 1000).toFixed(1)} s`);
    await B.cmd('M1 STOP', 200);
  }
  await B.world('lampAz', 25);
  await move('GOTO 0');

  // ---- a noisy board: 25 mV per ADC sample (Sonnet audit F04: 6-22 s to lock, never with ctl.db 0.15)
  section('noisy ADC (25 mV per sample): ctl.adapt averages longer and widens the deadband only as needed');
  await B.world('noiseMv', 25);
  for (const db of [0.3, 0.15]) {
    await setOk('ctl.db', db);
    await move('GOTO -5');   // 30 deg away from the lamp
    B.send('M1 START 0');
    u = await B.until(isE('M1', 'HOLD'), 30000, 100);
    await B.run(2000);
    t = await B.truth();
    check(`25 mV noise, ctl.db ${db}: locks within 12 s, true error < 0.6 deg`, !!u.hit && u.ms <= 12000 && Math.abs(t.theta) < 0.6,
      u.hit ? `${(u.ms / 1000).toFixed(1)} s (${u.hit.args.slice(1).join(' ')}), true error ${f2(t.theta, 3)}` : 'no HOLD in 30 s');
    note(`25 mV noise, ctl.db ${db}: lock time / true error`, u.hit ? `${(u.ms / 1000).toFixed(1)} s / ${f2(t.theta, 3)} deg` : 'no lock');
    await B.cmd('M1 STOP', 200);
  }
  await setOk('ctl.db', 0.3);
  await move('GOTO 25');
  r = await B.cmd('RAW 1000', 1500);
  const rNoisy = jOf(r, 'raw')[0];
  await B.world('noiseMv', 4);
  r = await B.cmd('RAW 1000', 1500);
  const rQuiet = jOf(r, 'raw')[0];
  check('RAW reports the per-window angle noise (th_sd): 25 mV board >> quiet board',
    rNoisy && rQuiet && rQuiet.n >= 40 && rQuiet.th_sd < 0.3 && rNoisy.th_sd > 3 * rQuiet.th_sd,
    rNoisy && rQuiet ? `th_sd ${rNoisy.th_sd} vs ${rQuiet.th_sd} deg (${rQuiet.n} windows)` : 'no raw');

  // ---------------------------------------------------------------- review: never report a fake success
  section('no fake success (review findings)');
  r = await B.cmd('@21 M1 START 100');
  check('M1 START with an out-of-range target -> ERR RANGE (never the old target)', errOf(r).some((m) => m.id === 21 && m.code === 'RANGE') && !r.some(isE('PROC', 'START')));
  await B.world('lampK', 60);    // lamp so strong both ADC channels clip at ~3100 mV
  const sj = await raw(300);
  check('clipped ADC reading is flagged sat and not valid', sj.sat === true && sj.valid === false, `mv ${sj.mv} sat=${sj.sat} valid=${sj.valid}`);
  B.send('M1 START 0');
  u = await B.until(isE('M1', 'HOLD'), 25000, 250);
  t = await B.truth();
  check('clipped ADC: M1 never declares HOLD', !u.hit, u.hit ? `HOLD while true error ${f2(t.theta, 2)} deg` : 'no HOLD in 25 s');
  check('clipped ADC: reason reported to the operator (adc_saturated)', u.lines.some((m) => m.kind === 'e' && m.evt === 'M1' && m.args.includes('adc_saturated')));
  check('clipped ADC: telemetry SAT flag set', u.lines.some((m) => m.kind === 't' && (m.vals[10] & 4)));
  await B.world('lampK', 1);
  u = await B.until(isE('M1', 'HOLD'), 60000, 250);
  t = await B.truth();
  check('light back to normal -> M1 recovers by itself', !!u.hit && Math.abs(t.theta) < 0.6, `true error ${f2(t.theta, 3)} after ${(u.ms / 1000).toFixed(1)} s`);
  await B.cmd('M1 STOP', 200);

  // ---------------------------------------------------------------- busy / stop handling
  section('busy / stop');
  B.send('SWEEP -40 40 5 300 x');
  await B.run(1500);
  r = await B.cmd('MOVE 5');
  check('MOVE during SWEEP -> ERR BUSY', errOf(r).some((m) => m.code === 'BUSY' && m.text === 'SWEEP'));
  r = await B.cmd('STOP', 100);
  check('STOP aborts', r.some((m) => m.kind === 'e' && m.evt === 'PROC' && m.args[1] === 'ABORT') && okOf(r).some((m) => m.text === 'stopped'));
  t0 = await B.truth();
  await B.run(500);
  t1 = await B.truth();
  check('motor stopped after STOP', t1.steps === t0.steps);
  r = await B.cmd('CAL LUT 0 1 ' + new Array(300).fill('0.1').join(','));
  check('LUT too long -> clear error', errOf(r).some((m) => m.code === 'ARG' && m.text.includes('too_many')));
  r = await B.cmd('CAL GET', 100);
  const calj = jOf(r, 'cal')[0];
  check('CAL GET returns the pushed LUT unchanged', calj && calj.lut && calj.lut.v.length === lut.v.length && Math.abs(calj.lut.v[3] - lut.v[3]) < 1e-3);

  // ---------------------------------------------------------------- mission 2
  section('mission 2 (camera)');
  r = await B.cmd('M2 SNAP');
  check('M2 SNAP without camera -> ERR CAM', errOf(r).some((m) => m.code === 'CAM'));
  await setOk('cam.model', 2);
  r = await B.cmd('M2 INIT', 400);
  check('wrong camera model -> init fails cleanly', errOf(r).some((m) => m.code === 'CAM' && m.text.includes('init fail')), errOf(r).map((m) => m.text).join());
  await setOk('cam.model', 1);
  r = await B.cmd('M2 INIT', 400);
  check('M2 INIT (S3-EYE pinout)', okOf(r).some((m) => m.text.includes('ok sensor')), okOf(r).map((m) => m.text).join());
  t = await B.truth();
  check('M2 INIT sets the picture flips itself (not left to the driver)', t.hm === 0 && t.vf === 0, `hm ${t.hm} vf ${t.vf}`);
  // an ESP32-CAM pinout on an ESP32-S3 would drive its flash pins (GPIO26/27/32): refused before the driver touches them
  await setOk('cam.model', 4);
  r = await B.cmd('M2 INIT', 400);
  const e4 = errOf(r).find((m) => m.code === 'CAM');
  const alive = okOf(await B.cmd('HELLO')).length === 1;
  check('cam.model 4 (ESP32-CAM pins) on an ESP32-S3 -> ERR CAM "not for this chip", board keeps running', !!e4 && e4.text.includes('not for this chip') && e4.text.includes('flash') && alive, e4 ? e4.text : errOf(r).map((m) => m.raw).join(' | '));
  await setOk('cam.model', 1);
  r = await B.cmd('M2 INIT', 400);
  check('back to cam.model 1 -> camera works again', okOf(r).some((m) => m.text.includes('ok sensor')));
  // the sensor answers but no frame ever comes (data/PCLK wired wrong): give up fast, never trip the 5 s watchdog
  await B.world('camFrames', 0);
  await B.req('!MAXLOOP', '!OK');
  B.send('M2 SNAP');
  u = await B.until((m) => m.kind === 'e' && m.evt === 'FAULT' && m.args[0] === 'SNAP', 20000, 200);
  const mlNoFrames = +(await B.req('!MAXLOOP', '!OK')).split(' ')[1];
  check('camera without frames -> FAULT SNAP no_frames, loop blocked < 5 s', !!u.hit && u.hit.args[1] === 'no_frames' && mlNoFrames < 5000, `${u.hit ? u.hit.raw : 'no fault'}, longest loop ${f2(mlNoFrames, 0)} ms`);
  await B.world('camFrames', 1);
  r = await B.cmd('HWID I2C', 400);
  const hw3 = jOf(r, 'hwid')[0];
  check('I2C scan refuses pins used by the camera', hw3 && typeof hw3.i2c === 'string' && hw3.i2c.startsWith('skipped'), hw3 ? JSON.stringify(hw3.i2c) : '');
  u = await (async () => { B.send('M2 LOCK'); return B.until(isJ('cam'), 5000); })();
  t = await B.truth();
  check('M2 LOCK freezes exposure', !!u.hit && u.hit.json.locked && t.aec === 0 && t.agcCtrl === 0);
  const snap = async (line) => {
    const n0 = B.images.length;
    B.send(line);
    const w = await B.until(() => B.images.length > n0, 60000, 200);
    const img = B.images[B.images.length - 1];
    const meta = jOf(w.lines, 'img_meta')[0];
    if (!img || B.images.length === n0) return { ok: false };
    const txt = Buffer.from(img.bytes).toString('latin1');
    const mm = txt.match(/NASASIM camAz=(\S+) lampAz=(\S+) targetAz=(\S+) err=(\S+) locked=(\d) moving=(\d)/);
    return { ok: img.ok, bytes: img.bytes.length, meta, ms: w.ms, err: mm ? +mm[4] : NaN, locked: mm ? +mm[5] : -1, moving: mm ? +mm[6] : -1, sun: jOf(w.lines, 'sun_ref')[0] };
  };
  await B.world('targetAz', -40);
  let s = await snap('M2 GO -40');
  check('M2 GO -40: photo received, CRC ok, JPEG', s.ok && s.meta && s.meta.w === 640, `${s.bytes} B in ${(s.ms / 1000).toFixed(1)} s`);
  check('photo taken still (not moving) with locked exposure', s.moving === 0 && s.locked === 1);
  check('without boresight correction the camera is off by ~its mount offset', Math.abs(s.err - 2.2) < 1.2, `true pointing error ${f2(s.err, 3)} deg (camera mount offset truth 2.2)`);
  await setOk('cam.off', 2.2);   // as measured with the tool's boresight step
  s = await snap('M2 GO -40');
  check('after cam.off: actuator-referenced pointing error < 1 deg', Math.abs(s.err) < 1.0, `true error ${f2(s.err, 3)} deg`);
  note('M2 actuator-referenced error (cam.off set)', `${f2(s.err, 3)} deg`);
  const errCamOff = s.err;
  // gear play NOT compensated (act.bl 0): a photo reached from above and one reached from below must still point the
  // same way, because M2 GO always arrives turning the ctl.appr way (a spot clicked in one photo is hit by the next)
  const blNow = cfg.get('act.bl');
  await setOk('act.bl', 0);
  await move('GOTO 10');
  const sAbove = await snap('M2 GO -20');
  await move('GOTO -60');
  const sBelow = await snap('M2 GO -20');
  check('act.bl 0: M2 GO from above and from below point the same way (< 0.3 deg apart)', sAbove.ok && sBelow.ok && Math.abs(sAbove.err - sBelow.err) < 0.3, `true errors ${f2(sAbove.err, 3)} / ${f2(sBelow.err, 3)} deg (gear play 1.4 deg)`);
  await setOk('act.bl', blNow);
  // compensation back on after running without it (as after re-running BACKLASH): the old stepper could stay off by
  // a whole act.bl for good; it now issues whatever play is still missing
  s = await snap('M2 GO -40');
  check('act.bl back on: the actuator frame is where it was (same pointing as before, < 0.3 deg)', s.ok && Math.abs(s.err - errCamOff) < 0.3, `true error ${f2(s.err, 3)} vs ${f2(errCamOff, 3)} deg before`);
  await B.world('bump', 7);      // satellite knocked: actuator zero no longer matches the room
  s = await snap('M2 GO -40');
  check('after a 7 deg knock the actuator reference is wrong', Math.abs(s.err - 7) < 1.2, `true error ${f2(s.err, 3)} deg`);
  s = await snap('M2 GO SUN -65'); // target is 65 deg clockwise of the lamp
  check('M2 GO SUN (reference = the lamp) is immune to the knock', s.ok && Math.abs(s.err) < 1.0 && s.sun, `true error ${f2(s.err, 3)} deg, sun_ref ${s.sun ? s.sun.sun_az : '-'}`);
  note('M2 sun-referenced error after a 7 deg knock', `${f2(s.err, 3)} deg`);
  const lastId = s.meta ? s.meta.id : 0;
  r = await B.cmd(`IMG GET ${lastId} 0,2`, 100);
  check('IMG GET resends chunks', r.filter((m) => m.kind === 'img' && m.parts[0] === 'C').length === 2 && okOf(r).length === 1);
  await setOk('cam.res', 0);
  s = await snap('M2 SNAP');
  check('cam.res 0 -> 320x240 photo', s.ok && s.meta && s.meta.w === 320);
  await setOk('cam.res', 1);
  // picture flips: the photo's metadata says which way it faces (the tool turns pixels into angles with it)
  await setOk('cam.hmirror', 1);
  await setOk('cam.vflip', 1);
  s = await snap('M2 SNAP');
  t = await B.truth();
  check('cam.hmirror/vflip 1 -> sensor flipped, img_meta hm=1 vf=1 (+ cam_dir, hfov)', s.ok && t.hm === 1 && t.vf === 1 && s.meta.hm === 1 && s.meta.vf === 1 && s.meta.cam_dir === 0 && s.meta.hfov === 62,
    s.meta ? JSON.stringify({ hm: s.meta.hm, vf: s.meta.vf, cam_dir: s.meta.cam_dir, hfov: s.meta.hfov, truth: [t.hm, t.vf] }) : 'no photo');
  await setOk('cam.hmirror', 0);
  await setOk('cam.vflip', 0);
  s = await snap('M2 SNAP');
  check('flips back to 0 for the next photo', s.ok && s.meta.hm === 0 && s.meta.vf === 0);
  // slow link: a board with a USB-UART chip at 115200 baud
  await B.world('txUsPerByte', 86.8);
  await B.req('!MAXLOOP', '!OK');
  s = await snap('M2 SNAP');
  const ml = +(await B.req('!MAXLOOP', '!OK')).split(' ')[1];
  check('115200-baud UART: photo still arrives intact', s.ok, `${s.bytes} B in ${(s.ms / 1000).toFixed(1)} s, longest loop ${f2(ml, 0)} ms`);
  check('loop never blocks long enough to trip the watchdog', ml < 1500);
  note('photo transfer 640x480 (USB / 115200 UART)', `fast / ${(s.ms / 1000).toFixed(1)} s`);
  await B.world('txUsPerByte', 0);
  r = await B.cmd('M2 UNLOCK', 100);
  t = await B.truth();
  check('M2 UNLOCK', t.aec === 1 && jOf(r, 'cam').some((j) => j.locked === false));
  await B.world('bump', 0);
  s = await snap('M2 GO -40');
  check('photo with auto exposure (camera kept streaming during m2.settle)', s.ok && s.meta && s.meta.locked === false && s.locked === 0);

  // ---- refusals: a mission photo is never taken off target
  r = await B.cmd('@23 M2 GO 500');
  check('M2 GO 500 -> ERR RANGE (m2.tgt), no motion', errOf(r).some((m) => m.id === 23 && m.code === 'RANGE'));
  let nImg = B.images.length;
  B.send('M2 GO 250');
  u = await B.until(isJ('snap_fail'), 8000);
  await B.run(1500);
  check('target outside act.min..act.max -> snap_fail, no photo', !!u.hit && u.hit.json.reason === 'target_out_of_range' && B.images.length === nImg && !u.lines.some(isJ('img_meta')), u.hit ? JSON.stringify(u.hit.json) : '');
  await move('GOTO 0');
  const sprNow = cfg.get('act.spr');
  await setOk('act.spr', 400);   // coarse steps (0.9 deg): the reachable angle misses the target by 0.2 deg
  await setOk('m2.tol', 0.05);
  nImg = B.images.length;
  B.send('M2 GO -40.3');
  u = await B.until(isJ('snap_fail'), 8000);
  await B.run(1500);
  check('pointing error > m2.tol -> snap_fail not_in_tol, no photo', !!u.hit && u.hit.json.reason === 'not_in_tol' && B.images.length === nImg, u.hit ? JSON.stringify(u.hit.json) : '');
  await setOk('act.spr', sprNow);
  await setOk('m2.tol', 1);

  // ---- mission 1 -> mission 2 handover
  B.send('M1 START 0');
  u = await B.until(isE('M1', 'HOLD'), 30000);
  s = await snap('@24 M2 SNAP');
  check('M2 SNAP works while M1 holds (boresight check), M1 keeps holding', s.ok && s.meta && s.meta.m1 === 'HOLD' && B.all.slice(-400).every((m) => !(m.kind === 'err' && m.id === 24)));
  const before = B.all.length;
  s = await snap('@25 M2 GO -40');
  const hand = B.all.slice(before);
  check('M2 GO while M1 runs: M1 hands over by itself, photo taken', s.ok && hand.some((m) => m.kind === 'e' && m.evt === 'M1' && m.args[0] === 'IDLE' && m.args[1] === 'm2_takeover'));

  // ---- lost image lines on the cable
  B.drop = new Map([[1, 1], [5, 1]]);
  s = await snap('M2 SNAP');
  check('2 image lines lost once -> tool asks again (IMG GET) -> photo intact', s.ok && B.dropped === 2, `dropped ${B.dropped}`);
  B.drop = new Map([[3, 99]]);
  B.dropped = 0;
  nImg = B.images.length;
  let threw = null;
  try { s = await snap('M2 SNAP'); } catch (e) { threw = e; }
  const lastImg = B.images[B.images.length - 1];
  check('a line that never arrives -> photo reported FAILED after 3 retries, no crash', !threw && B.images.length === nImg + 1 && lastImg.ok === false && lastImg.missing === 1, threw ? threw.message : `ok=${lastImg && lastImg.ok} missing=${lastImg && lastImg.missing}`);
  B.drop = null;
  s = await snap('M2 SNAP');
  check('next photo after a failed one is fine', s.ok);

  // ---- STOP must stay responsive while a photo crawls over a 115200-baud UART
  await B.world('txUsPerByte', 86.8);
  nImg = B.images.length;
  B.send('M2 SNAP');
  await B.until((m) => m.kind === 'img' && m.parts[0] === 'B', 10000, 50);
  B.send('@77 STOP');
  let lat = 0;
  for (; lat < 3000; lat += 20) { const got = await B.run(20); if (got.some((m) => m.kind === 'ok' && m.id === 77)) break; }
  check('STOP answered within 0.4 s during a UART photo transfer', lat <= 400, `${lat + 20} ms (simulated)`);
  note('STOP latency during photo transfer at 115200 baud', `${lat + 20} ms`);
  await B.until(() => B.images.length > nImg, 20000, 200);
  await B.world('txUsPerByte', 0);

  // ---------------------------------------------------------------- servo actuator
  section('servo actuator (act.type 2)');
  await B.world('actuator', 2);
  await setOk('act.type', 2);
  await move('GOTO 0');
  await B.run(800);
  B.send('M1 START 0');
  u = await B.until(isE('M1', 'HOLD'), 30000);
  t = await B.truth();
  check('M1 with a (slightly inaccurate) servo still locks', !!u.hit && Math.abs(t.theta) < 1.0, `true error ${f2(t.theta, 3)}`);
  r = await B.cmd('HWID', 100);
  check('servo PWM attached at 14 bit (accepted by the strict ESP32-S3 LEDC mock)', (jOf(r, 'hwid')[0] || {}).actuator === 'servo' && !B.warn.some((w) => w.includes('ledc')), (jOf(r, 'hwid')[0] || {}).actuator);
  await B.cmd('M1 STOP', 200);
  await setOk('act.type', 1);
  await B.world('actuator', 1);

  // ---------------------------------------------------------------- persistence
  section('flash persistence (SAVE / REBOOT / LOAD / DEFAULTS)');
  await setOk('ctl.k', 0.9);
  await B.cmd('SAVE');
  await setOk('ctl.k', 0.5);
  // CAL TH0 writes the zero (and only the zero) to flash by itself: a reset before SAVE must not lose it
  await move('GOTO 18');
  tt = await B.truth();
  B.send(`CAL TH0 ${tt.theta.toFixed(2)}`);
  u = await B.until(isJ('th0'), 5000);
  const th0New = u.hit ? u.hit.json.new : NaN;
  check('CAL TH0 answers saved:true', !!u.hit && u.hit.json.saved === true, u.hit ? JSON.stringify(u.hit.json) : '');
  if (u.hit) cfg.set('est.th0', th0New);
  r = await B.cmd('REBOOT', 1500);
  check('REBOOT -> board restarts', B.restarted === 1 && r.some((m) => m.kind === 'e' && m.evt === 'BOOT' && m.args[0] === 'SOFTWARE'), `restarts ${B.restarted}`);
  r = await B.cmd('CFG LIST', 100);
  const it2 = (jOf(r, 'cfg')[0] || {}).items || [];
  const g = (k) => (it2.find((x) => x.k === k) || {}).v;
  check('saved values survive reboot', g('ctl.k') === 0.9 && Math.abs(g('est.alpha') - cfg.get('est.alpha')) < 1e-3 && Math.abs(g('act.spr') - cfg.get('act.spr')) < 1e-3, `ctl.k=${g('ctl.k')} est.alpha=${g('est.alpha')} act.spr=${g('act.spr')}`);
  check('est.th0 from CAL TH0 survives a reboot without SAVE (the unsaved ctl.k 0.5 did not)', Math.abs(g('est.th0') - th0New) < 2e-3 && g('ctl.k') === 0.9, `est.th0=${g('est.th0')} (CAL TH0 gave ${th0New})`);
  r = await B.cmd('CAL GET', 100);
  const c2 = jOf(r, 'cal')[0];
  check('LUT survives reboot', c2 && c2.lut && c2.lut.v.length === lut.v.length);
  await B.cmd('DEFAULTS');
  r = await B.cmd('GET est.alpha');
  check('DEFAULTS', okOf(r).some((m) => m.text === 'est.alpha=30'));
  await B.cmd('LOAD');
  r = await B.cmd('GET ctl.k');
  check('LOAD restores flash values', okOf(r).some((m) => m.text === 'ctl.k=0.9'));
  B.send('M1 START 0');
  u = await B.until(isE('M1', 'HOLD'), 40000);
  t = await B.truth();
  check('after reboot M1 works with the stored calibration', !!u.hit && Math.abs(t.theta) < 0.6, `true error ${f2(t.theta, 3)}`);
  await B.cmd('STOP');

  // ---------------------------------------------------------------- bright conference room
  // another kit whose two housings differ (qL 1.25 / qR 1.45): without the gamma ratio the zero moves 3-7 deg when
  // the lamp brightness changes (probe); the ratio is a property of the LDRs, so the one measured above is reused
  section('bright room (ceiling lights ~30% of the lamp) + uneven housings: recalibrate, then vary the lamp');
  await B.cmd('STOP');
  await B.world('qL', 1.25);
  await B.world('qR', 1.45);
  await B.world('ambient', 0.3);
  await B.world('lampOn', 0);
  B.send('AMB 500');
  u = await B.until(isJ('amb'), 8000);
  const amb2 = u.hit ? u.hit.json : null;
  await B.world('lampOn', 1);
  // procedure: face the lamp roughly (here with M1), make that the actuator zero, then sweep around it
  B.send('M1 START 0');
  await B.until(isE('M1', 'HOLD'), 30000);
  await B.cmd('M1 STOP', 200);
  await B.cmd('ZERO');
  const pts2 = [];
  B.send('SWEEP -60 60 5 300 cal');
  u = await B.until(isJ('sweep_end'), 120000, 500);
  for (const j of jOf(u.lines, 'sweep_pt')) pts2.push({ ang: j.ang, mvL: j.mv[0], mvR: j.mv[1], GL: NS.est.toG(j.mv[0], 3300, 0), GR: NS.est.toG(j.mv[1], 3300, 0), sat: j.sat });
  const fitB = NS.fit.fitPhysical(pts2, { gamma: 0.6, alpha0: 30, fitQ: true, amb: ambArg(amb2), gRatio });
  const estB = NS.fit.toEst(fitB.P, { vcc: 3300, topo: 0 });
  const nearB = pts2.filter((p) => Math.abs(fitB.P.phi - p.ang) < 12).map((p) => NS.est.estimate(p.GL, p.GR, { ...estB, lutOn: 0 }).S);
  estB.minS = +((nearB.length ? NS.median(nearB) : 1) * 0.15).toPrecision(3);
  const rngB = NS.fit.range(pts2, estB, fitB.P.phi);
  if (rngB) estB.dmax = rngB.dmax;
  estB.lut = NS.fit.buildLUT(pts2, estB, fitB.P.phi, { dx: 1 });
  let okB = 0;
  const pushB = NS.fit.pushLines(estB);
  for (const l of pushB) { const rr = await B.cmd(l, 80); if (okOf(rr).length === 1) okB++; }
  check('bright room: AMB + sweep + fit + push', okB === pushB.length && fitB.rms < 0.05, `fit rms ${f2(fitB.rms, 4)} gamma L/R ${f2(fitB.P.gL, 3)}/${f2(fitB.P.gR, 3)}, ${okB}/${pushB.length} lines`);
  await move('GOTO -2');   // near the lamp, like aiming with a sighting tube
  tt = await B.truth();
  B.send(`CAL TH0 ${tt.theta.toFixed(2)}`);
  u = await B.until(isJ('th0'), 5000);
  check('bright room: CAL TH0 near the lamp', !!u.hit, u.hit ? JSON.stringify(u.hit.json) : '');
  const brightErr = [];
  for (const K of [0.5, 1, 1.8]) {
    await B.world('lampK', K);
    B.send('M1 START 0');
    u = await B.until(isE('M1', 'HOLD'), 30000);
    await B.run(1500);
    t = await B.truth();
    brightErr.push(t.theta);
    check(`bright room, lamp x${K}: M1 true error < 0.6 deg`, !!u.hit && Math.abs(t.theta) < 0.6, `true error ${f2(t.theta, 3)}`);
  }
  note('bright room + uneven housings, lamp x0.5/x1/x1.8: true M1 error', brightErr.map((x) => f2(x, 2)).join(' / ') + ' deg');
  await B.world('lampK', 1);
  await B.cmd('STOP');

  // ---------------------------------------------------------------- no laptop: housekeeping, button, auto start, radio
  section('no laptop: housekeeping (J hk), BOOT button, automatic start, second port (radio)');
  r = await B.run(4500);
  const hks = jOf(r, 'hk');
  const hk0 = hks[hks.length - 1];
  check('J hk every 2 s: chip temperature, heap, longest loop, M1 state, button pin', hks.length >= 2 && hks.length <= 3 && hk0.temp_c === 41.5 && hk0.heap > 0 && hk0.heap_min > 0 && hk0.loop_max_ms >= 0 && hk0.loop_max_ms < 50 && hk0.vbat_mv === null && hk0.btn === 0 && hk0.m1 === 'IDLE',
    hk0 ? `${hks.length} in 4.5 s: ${JSON.stringify(hk0)}` : 'none');
  await B.world('vbatPin', 3);
  await setOk('hw.vbat', 3);
  await setOk('hw.vdiv', 3);
  u = await B.until(isJ('hk'), 3000);
  check('battery voltage through hw.vbat / hw.vdiv', !!u.hit && Math.abs(u.hit.json.vbat_mv - 7400) < 7400 * 0.02, u.hit ? `${u.hit.json.vbat_mv} mV (truth 7400)` : 'no hk');
  await setOk('com.hk', 0);
  r = await B.run(4500);
  check('com.hk 0 -> no J hk', jOf(r, 'hk').length === 0);
  await setOk('com.hk', 2);

  // the BOOT button (hw.btn 0 = GPIO0): press = start mission 1, press again = stop, a held button acts once
  await move('GOTO 0');
  await B.world('btnDown', 1);
  u = await B.until(isE('BTN'), 1000, 50);
  check('BOOT button pressed -> E BTN M1_START', !!u.hit && u.hit.args[0] === 'M1_START', u.hit ? u.hit.raw : 'no BTN event');
  r = await B.run(2000);
  check('a button held down acts only once', !r.some(isE('BTN')));
  await B.world('btnDown', 0);
  const holdEarly = r.find(isE('M1', 'HOLD'));  // may already have locked while the button was held
  u = holdEarly ? { hit: holdEarly, lines: [] } : await B.until(isE('M1', 'HOLD'), 30000);
  check('... mission 1 runs and locks without any command from the laptop', !!u.hit, u.hit ? u.hit.raw : 'no HOLD');
  await B.run(300);  // released for a moment (the button re-arms after 100 ms up)
  await B.world('btnDown', 1);
  u = await B.until(isE('BTN'), 1000, 50);
  await B.world('btnDown', 0);
  r = await B.run(300);
  check('second press -> E BTN M1_STOP -> M1 IDLE', !!u.hit && u.hit.args[0] === 'M1_STOP' && [...u.lines, ...r].some(isE('M1', 'IDLE')), u.hit ? u.hit.raw : 'no BTN event');

  // automatic start after power-on (battery, no laptop): m1.auto seconds, kept with "SAVE m1.auto" only
  await setOk('m1.auto', 2);
  r = await B.cmd('SAVE m1.auto');
  check('SAVE m1.auto saves just that key', okOf(r).some((m) => m.text === 'saved 1'));
  await move('GOTO -20');
  r = await B.cmd('REBOOT', 1500);
  check('m1.auto 2 -> after power-on: E AUTO M1_IN 2', r.some((m) => m.kind === 'e' && m.evt === 'AUTO' && m.args[0] === 'M1_IN' && m.args[1] === '2'), r.filter((m) => m.kind === 'e').map((m) => m.raw).join(' | '));
  u = await B.until(isE('M1', 'HOLD'), 30000);
  check('... then mission 1 starts by itself (E AUTO M1_START) and locks', u.lines.some(isE('AUTO', 'M1_START')) && !!u.hit, u.hit ? `HOLD ${(u.ms / 1000).toFixed(1)} s after boot` : 'no HOLD');
  await B.cmd('STOP', 200);
  await B.cmd('REBOOT', 1500);
  r = await B.cmd('STOP', 300);
  const rAfter = await B.run(3500);
  const startedM1 = [...r, ...rAfter].some((m) => m.kind === 'e' && ((m.evt === 'AUTO' && m.args[0] === 'M1_START') || (m.evt === 'PROC' && m.args[0] === 'M1')));
  check('STOP while it waits -> E AUTO CANCELLED, mission 1 never starts', r.some(isE('AUTO', 'CANCELLED')) && !startedM1, r.filter((m) => m.kind === 'e').map((m) => m.raw).join(' | '));
  await setOk('m1.auto', 0);
  await B.cmd('SAVE m1.auto');

  // second port: a 9600-baud serial radio (HC-12 style) wired to GPIO21 (RX) / GPIO14 (TX)
  await setOk('com.baud', 9600);
  await setOk('com.rx', 21);
  r = await B.cmd('SET com.tx 14', 200);
  check('SET com.tx -> E LINK ON (second port up)', r.some(isE('LINK', 'ON')), r.filter((m) => m.kind === 'e').map((m) => m.raw).join(' | '));
  B.link.length = 0;
  r = await B.run(3000);
  const linkT = B.link.filter((m) => m.kind === 't').length;
  const usbT = r.filter((m) => m.kind === 't').length;
  check('the radio gets telemetry at com.lhz (2 Hz) and J hk; USB keeps 20 Hz', linkT >= 4 && linkT <= 8 && B.link.some(isJ('hk')) && usbT >= 50, `${linkT} rows on the radio, ${usbT} on USB in 3 s`);
  B.link.length = 0;
  B.linkSend('@71 HELLO');
  await B.run(2000);
  check('command over the radio: @71 HELLO answered on the radio', B.link.some((m) => m.kind === 'ok' && m.id === 71) && B.link.some(isJ('hello')), B.link.filter((m) => m.kind !== 't').map((m) => m.raw.slice(0, 60)).join(' | '));
  await move('GOTO -15');
  B.linkSend('@72 M1 START 0');
  u = await B.until(isE('M1', 'HOLD'), 30000);
  await B.run(1500);
  check('M1 START over the radio -> locks (the USB side sees it too)', !!u.hit && B.link.some((m) => m.kind === 'ok' && m.id === 72), u.hit ? u.hit.raw : 'no HOLD');
  B.linkSend('@73 STOP');
  await B.run(1500);
  check('STOP over the radio', B.link.some((m) => m.kind === 'ok' && m.id === 73));
  // far more output than the radio can carry (6 x CFG LIST ~ 6 x 21 KB into a 64 KB buffer, 960 bytes/s out): the
  // loop must never wait for the radio, and the radio may lose whole lines but never get half a line
  await B.req('!MAXLOOP', '!OK');
  B.link.length = 0;
  for (let k = 0; k < 6; k++) await B.cmd('CFG LIST', 50);
  const mlBurst = +(await B.req('!MAXLOOP', '!OK')).split(' ')[1];
  r = await B.run(90000);
  const hkLink = jOf(r, 'hk').pop();
  const cfgOnRadio = B.link.filter(isJ('cfg')).map((m) => m.json);
  check('6 x CFG LIST into a 9600-baud radio: loop never waits (< 50 ms)', mlBurst < 50, `longest loop ${f2(mlBurst, 1)} ms`);
  check('... the radio got whole lines only (complete CFG LISTs, the overflow dropped as whole lines)',
    B.link.every((m) => m.kind !== 'bad' && m.kind !== 'text') && cfgOnRadio.length >= 1 && cfgOnRadio.length < 6 && cfgOnRadio.every((j) => j.items.length === NS.CFG_DEFS.length) && hkLink && hkLink.link && hkLink.link.drop >= 1,
    `${cfgOnRadio.length} complete CFG LIST, ${hkLink && hkLink.link ? hkLink.link.drop : '?'} lines dropped, ${B.link.length} lines in all`);
  // a photo over the radio: a 320x240 photo fits the 64 KB buffer at once and drains in ~9 s
  await setOk('cam.res', 0);
  let nLinkImg = B.linkImages.length;
  s = await snap('M2 SNAP');
  u = await B.until(() => B.linkImages.length > nLinkImg, 60000, 500);
  let li = B.linkImages[B.linkImages.length - 1];
  check('photo (320x240) over the 9600-baud radio arrives intact; USB copy too', s.ok && !!u.hit && li.ok && li.bytes.length === s.bytes,
    li ? `${li.bytes.length} B, radio ${(u.ms / 1000).toFixed(1)} s after USB, retries ${li.retries}` : 'no photo on the radio');
  note('photo 320x240 over a 9600-baud radio', u.hit ? `${(u.ms / 1000 + s.ms / 1000).toFixed(1)} s` : '-');
  // a board without PSRAM has only an 8 KB radio buffer: a 640x480 photo (~33 KB of lines) is paced to the radio,
  // every line waits until it fits whole, and the loop never waits for the radio (only for the camera's own frames)
  await B.world('psram', 0);
  await B.cmd('SET com.tx -1', 100);
  r = await B.cmd('SET com.tx 14', 200);
  await setOk('cam.res', 1);
  nLinkImg = B.linkImages.length;
  await B.req('!MAXLOOP', '!OK');
  s = await snap('M2 SNAP');
  u = await B.until(() => B.linkImages.length > nLinkImg, 60000, 500);
  const mlImg = +(await B.req('!MAXLOOP', '!OK')).split(' ')[1];
  li = B.linkImages[B.linkImages.length - 1];
  check('no PSRAM (8 KB radio buffer), 640x480 photo: paced to the radio, intact on both sides, loop < 400 ms', r.some(isE('LINK', 'ON')) && s.ok && s.ms > 20000 && !!u.hit && li.ok && li.bytes.length === s.bytes && mlImg < 400,
    li ? `${li.bytes.length} B in ${(s.ms / 1000).toFixed(1)} s, radio retries ${li.retries}, longest loop ${f2(mlImg, 1)} ms (camera frames)` : 'no photo on the radio');
  note('photo 640x480 over a 9600-baud radio, 8 KB buffer', s.ok ? `${(s.ms / 1000).toFixed(1)} s` : '-');
  await B.world('psram', 1);
  await B.cmd('SET com.tx -1', 200);
  B.link.length = 0;
  await B.run(2000);
  check('com.tx -1 -> second port off (radio silent)', B.link.length === 0, `${B.link.length} lines`);

  // ---------------------------------------------------------------- hygiene over the whole session
  section('protocol hygiene (every line of the session)');
  check('every line parses (no bad/unknown lines)', B.bad.length === 0, B.bad.slice(0, 3).join(' | '));
  check('no watchdog trips / warnings', B.warn.length === 0, B.warn.slice(0, 3).join(' | '));
  const events = new Set(B.all.filter((m) => m.kind === 'e').map((m) => m.evt));
  check('event kinds seen', ['BOOT', 'PROC', 'M1'].every((x) => events.has(x)), [...events].join(','));
  const faults = B.all.filter((m) => m.kind === 'e' && m.evt === 'FAULT' && !(m.args[0] === 'SNAP' && ['target_out_of_range', 'not_in_tol', 'no_frames'].includes(m.args[1])));
  check('no unexpected FAULT events (only the provoked ones)', faults.length === 0, faults.map((m) => m.raw).join(' | '));
  const done = B.lastDone || '';
  console.log(`     ${B.all.length} lines, simulated ${done.match(/t=([\d.]+)/) ? (+done.match(/t=([\d.]+)/)[1] / 1000).toFixed(0) : '?'} s`);

  await B.quit();
  fs.rmSync(stateDir, { recursive: true, force: true });

  console.log('\n== summary');
  for (const [k, v] of summary) console.log(`  ${k.padEnd(48)} ${v}`);
  console.log(`\n${passes} passed, ${fails} failed${fails ? ': ' + failed.join('; ') : ''}`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
