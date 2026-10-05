// Quick end-to-end test of the backup sketch firmware/Fallback/Fallback.ino in the same simulated world.
// usage:  node build.js --fallback && node fallback_test.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NS, Board, isJ, isE, okOf, errOf, jOf } = require('./harness');

let passes = 0;
let fails = 0;
const check = (name, cond, info = '') => {
  if (cond) { passes++; console.log(`  ok   ${name} ${info}`); } else { fails++; console.log(`  FAIL ${name} ${info}`); }
};
const f2 = (x, d = 2) => (NS.isNum(x) ? x.toFixed(d) : String(x));

(async () => {
  const exe = path.join(__dirname, 'build', 'fallback_host' + (process.platform === 'win32' ? '.exe' : ''));
  if (!fs.existsSync(exe)) { console.log('missing build: node build.js --fallback'); process.exitCode = 1; return; }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nasasat-fb-'));
  const B = new Board(exe, stateDir);
  await B.start();
  let r = await B.run(500);
  check('boot: banner, event, telemetry header', r.some((m) => m.kind === 'info') && r.some(isE('BOOT')) && r.some((m) => m.kind === 'th' && m.cols.join(',') === NS.TEL_COLS.join(',')));
  const tl = r.filter((m) => m.kind === 't');
  check('telemetry parses with the tool (11 columns)', tl.length >= 3 && tl.every((m) => m.vals.length === 11 && m.vals.every(Number.isFinite)), `${tl.length} lines`);
  r = await B.cmd('@1 HELLO', 100);
  check('HELLO json + @id OK', jOf(r, 'hello').length === 1 && okOf(r).some((m) => m.id === 1));
  r = await B.cmd('@2 SET ctl.k 0.9', 100);
  check('SET answers k=v', okOf(r).some((m) => m.id === 2 && m.text === 'ctl.k=0.9'));
  r = await B.cmd('@3 NOPE', 100);
  check('unknown command -> ERR CMD', errOf(r).some((m) => m.id === 3 && m.code === 'CMD'));

  // operator faces the lamp by eye (here: truth), balances, then turns away and lets M1 bring it back
  await B.cmd('GOTO 25', 1500);
  let t = await B.truth();
  r = await B.cmd('BAL', 1200);
  const bal = jOf(r, 'bal')[0];
  check('BAL at the lamp', bal && bal.g > 0.2 && bal.g < 5, bal ? `g=${bal.g} (true angle ${f2(t.theta)} deg)` : '');
  await B.cmd('GOTO -20', 3000);
  B.send('M1 START 0');
  const u = await B.until(isE('M1', 'HOLD'), 30000, 200);
  await B.run(2000);
  t = await B.truth();
  check('M1 locks on the lamp (backup accuracy: < 1.5 deg)', !!u.hit && Math.abs(t.theta) < 1.5, `true error ${f2(t.theta, 3)} deg after ${(u.ms / 1000).toFixed(1)} s`);
  r = await B.cmd('@4 MOVE 5', 100);
  check('MOVE refused while M1 runs', errOf(r).some((m) => m.id === 4 && m.code === 'BUSY'));
  // clipped ADC must never be reported as on target
  await B.world('lampK', 60);
  const w = await B.until(isE('M1', 'LOST'), 10000, 200);
  check('clipped ADC -> LOST adc_saturated (no fake HOLD)', !!w.hit && w.hit.args[1] === 'adc_saturated');
  await B.world('lampK', 1);
  r = await B.cmd('@5 STOP', 200);
  check('STOP', okOf(r).some((m) => m.id === 5) && r.some(isE('M1', 'IDLE')));
  check('every line parses', B.bad.length === 0, B.bad.slice(0, 3).join(' | '));
  await B.quit();
  fs.rmSync(stateDir, { recursive: true, force: true });
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
