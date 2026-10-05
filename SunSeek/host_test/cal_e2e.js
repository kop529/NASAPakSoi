// W4 end to end: the web tool's SunSeek calibration (NasaSat/tool: NS.fit.calibrate + NS.ss.teamLines) against the team
// firmware (build/sunseek_host = the real sketch + mocks + sim_world). What the calibration page does on the real board:
//   lamp off -> TEAM_SUN (room light) · turn the satellite to each mark -> TEAM_SUN · two lamp levels -> gamma ratio
//   -> Fit -> TEAM_SET sun.* / TEAM_LUT_* / sun.model 1 / TEAM_SAVE -> check angles -> th0 at a reference.
// Run inside WSL after run.sh has built the program (run.sh runs it).
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tool = path.resolve(__dirname, '..', '..', 'NasaSat', 'tool', 'src', 'js');
for (const f of ['01_util.js', '02_protocol.js', '02b_sunseek.js', '04_estimator.js', '05_fit.js']) require(path.join(tool, f));
const NS = globalThis.NS;

const exe = path.join(__dirname, 'build', 'sunseek_host');
let passes = 0, fails = 0;
const check = (name, cond, info = '') => {
  if (cond) { passes++; console.log(`  ok   ${name} ${info}`); } else { fails++; console.log(`  FAIL ${name} ${info}`); }
};
function run(lines, nvs) {
  const r = spawnSync(exe, { input: lines.join('\n') + '\n', encoding: 'utf8', env: { ...process.env, SUNSEEK_NVS: nvs || '' }, maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new Error(`sunseek_host exited ${r.status}: ${r.stderr}`);
  return r.stdout.split('\n').filter((l) => l.length);
}
const kv = (line) => { const t = line.split(',').slice(1); const o = {}; for (let i = t.length % 2; i + 1 < t.length; i += 2) o[t[i]] = +t[i + 1]; return o; };
const stateOf = (l) => Object.fromEntries(l.slice(7).split(' ').map((p) => { const [k, v] = p.split('='); return [k, +v]; }));
// groups of TM,TEAM_T readings, each closed by a #STATE line
function groups(out) {
  const g = [];
  let cur = [];
  for (const l of out) {
    if (l.startsWith('TM,TEAM_T,')) cur.push(kv(l));
    else if (l.startsWith('#STATE ')) { g.push({ rows: cur, st: stateOf(l), avg: NS.ss.avgTeamT(cur) }); cur = []; }
  }
  return g;
}
const read = (n = 4) => Array.from({ length: n }, () => ['TEAM_SUN', '#WAIT 30']).flat().concat('#STATE');
const VCC = 3300, TOPO = 0;
const pt = (ang, a) => ({ ang, mvL: a.mvL, mvR: a.mvR, GL: NS.est.toG(a.mvL, VCC, TOPO), GR: NS.est.toG(a.mvR, VCC, TOPO), sat: a.sat || undefined });
const MARKS = []; for (let a = -60; a <= 60; a += 5) MARKS.push(a);

// one whole calibration on a world; markSign -1 = the platform marks count clockwise
function calibrate(name, world, markSign) {
  console.log(`${name}`);
  const nvs = path.join(os.tmpdir(), `sunseek_cal_${process.pid}_${Math.random().toString(36).slice(2)}.txt`);
  const W = world.map((w) => `#SET ${w}`);
  // 1. collect: room light, sweep by marks, two lamp levels at mark 0 (lamp at world 0 -> the sun angle is -body)
  const out = run([...W, '#SET lamp 0', '#SET lampK 0', '#WAIT 400', ...read(6),
    '#SET lampK 1', ...MARKS.flatMap((a) => [`#SET body ${a}`, '#WAIT 120', ...read()]),
    '#SET body 0', '#WAIT 200', ...read(8), '#SET lampK 0.4', '#WAIT 300', ...read(8)], nvs);
  const g = groups(out);
  const amb = g[0].avg;
  const sweep = g.slice(1, 1 + MARKS.length);
  const l1 = g[1 + MARKS.length].avg, l2 = g[2 + MARKS.length].avg;
  const G = (a) => ({ GL: NS.est.toG(a.mvL, VCC, TOPO), GR: NS.est.toG(a.mvR, VCC, TOPO), ang: 0 });
  const pts = sweep.map((x, i) => pt(markSign * MARKS[i], x.avg));
  // organizer angle sign at a sun angle of +20 deg (body -20): 90*NDV under sun.model 0
  const orgAt20 = sweep[MARKS.indexOf(-20)].avg.ang;

  // 2. fit exactly as the page does (SunSeek mode: positiveAlpha)
  const c = NS.fit.calibrate(pts, { gamma: 0.6, alpha0: 30, fitQ: true, amb: G(amb), gr: { l1: G(l1), l2: G(l2) }, vcc: VCC, topo: TOPO, lutDx: 1, positiveAlpha: true });
  console.log(`       fit: alpha ${c.r.P.alpha.toFixed(2)}, flipped ${c.flipped}, gRatio ${c.gRatio.toFixed(3)}, fit MAE ${c.mLut.mae.toFixed(3)} deg, range ${c.rng.lo.toFixed(0)}..${c.rng.hi.toFixed(0)}`);
  check('flipped exactly when marks count clockwise XOR the LDR pins are swapped', c.flipped === ((markSign < 0) !== world.includes('swap 1')));
  const lines = NS.ss.teamLines(c.est);

  // 3. push into the firmware, then check angles between the marks (points the fit never saw)
  const checkAt = MARKS.slice(0, -1).map((a) => a + 2.5).filter((a) => -a >= c.rng.lo + 3 && -a <= c.rng.hi - 3);
  const out2 = run([...W, '#SET lamp 0', ...lines, '#WAIT 50', 'TEAM_INFO', ...checkAt.flatMap((a) => [`#SET body ${a}`, '#WAIT 120', ...read()])], nvs);
  const errs = out2.filter((l) => l.startsWith('ERR,'));
  check('all lines accepted', errs.length === 0 && out2.filter((l) => l.startsWith('ACK,')).length >= lines.length, errs[0] || `${lines.length} lines`);
  check('board now on the team model with the LUT', !!out2.find((l) => /^TM,TEAM_FW,[^,]+,SUN_MODEL,1,UNSAVED,0,LUT_N,[1-9]/.test(l)));
  const gv = groups(out2);
  // swapped LDR pins: the organizer's angle is the mirror of the physical one, and ours follows it on purpose
  const conv = world.includes('swap 1') ? -1 : 1;
  const e = gv.map((x) => x.avg.th - conv * x.st.sun);
  const mae = e.reduce((s, x) => s + Math.abs(x), 0) / e.length;
  const max = Math.max(...e.map(Math.abs));
  check(`angle error between the marks (${checkAt.length} points, sun ${(-checkAt[checkAt.length - 1]).toFixed(1)}..${(-checkAt[0]).toFixed(1)} deg): MAE < 0.4, max < 1`, mae < 0.4 && max < 1, `MAE ${mae.toFixed(3)} max ${max.toFixed(3)}`);
  check('SUN_ANGLE (what the ADCS uses) = the team angle', gv.every((x) => Math.abs(x.avg.ang - x.avg.th) < 1e-6));
  const at20 = gv.find((x) => Math.abs(x.st.sun - 17.5) < 0.1 || Math.abs(x.st.sun - 22.5) < 0.1);
  check('the team angle keeps the sign of the organizer angle (adcs.sign stays valid)', Math.sign(at20.avg.th) === Math.sign(orgAt20), `team ${at20.avg.th.toFixed(2)} / organizer ${orgAt20.toFixed(2)}`);

  // 4. th0 at a reference (step 8): the satellite faces the lamp (truth 0) but say the judges' zero is 1.5 deg off
  const out3 = run([...W, '#SET lamp 0', '#SET body 0', '#WAIT 200', 'TEAM_GET,sun.th0', ...read(8)], nvs);
  const cur = +out3.find((l) => l.startsWith('TM,TEAM_PARAM,sun.th0,')).split(',')[3];
  const now = groups(out3)[0].avg.th;
  const nv = NS.ss.th0For(cur, now, 1.5);
  const out4 = run([...W, '#SET lamp 0', '#SET body 0', `TEAM_SET,sun.th0,${nv}`, 'TEAM_SAVE', '#WAIT 200', ...read(8)], nvs);
  const after = groups(out4)[0].avg.th;
  check('th0 step: the reading becomes the reference', Math.abs(after - 1.5) < 0.1, `before ${now.toFixed(3)} after ${after.toFixed(3)} (th0 ${cur} -> ${nv})`);
  const out5 = run(['TEAM_INFO', '#WAIT 20'], nvs);
  check('everything survives a reset (TEAM_SAVE)', !!out5.find((l) => /^TM,TEAM_FW,[^,]+,SUN_MODEL,1,UNSAVED,0,LUT_N,[1-9]/.test(l)));
  fs.rmSync(nvs, { force: true });
}

calibrate('calibration page flow, marks counter-clockwise (+) seen from above', [], 1);
calibrate('marks counted clockwise (page flips them)', [], -1);
calibrate('LDR pins swapped on the board (organizer angle sign reversed too)', ['swap 1'], 1);
calibrate('lit room (ambient 0.3) + 100 Hz flicker 20 %', ['ambient 0.3', 'flicker 0.2'], 1);

console.log(`\n${passes} passed, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
