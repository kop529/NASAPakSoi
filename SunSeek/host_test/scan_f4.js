// F4 parameter scan on the simulated world (not a pass/fail test). Run inside WSL after run.sh has built the program:
//   node /mnt/c/TYSC/SunSeek/host_test/scan_f4.js
// Prints final error / worst error in the last 5 s / overshoot / time to |e|<1 deg for each combination.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const exe = path.join(__dirname, 'build', 'sunseek_host');
const AMB = Math.pow(10000 / 15000, 1 / 0.6) * 0.032 / 0.1;
const CAL = ['TEAM_SET,sun.model,1', `TEAM_SET,sun.aL,${AMB.toFixed(5)}`, `TEAM_SET,sun.aR,${AMB.toFixed(5)}`];
const WHEEL = ['TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5'];

function loop(world, team, secs = 30, strategy = 'REACTION') {
  const lines = [...world.map((w) => `#SET ${w}`), '#SET rateSign -1', '#SET lamp 30', '#WAIT 300', ...CAL, ...WHEEL, ...team,
    `ADCS_STRATEGY,${strategy}`, 'ADCS_MODE,AUTO', ...Array.from({ length: secs * 5 }, () => ['#WAIT 200', '#STATE']).flat(), 'STOP', '#WAIT 10'];
  const r = spawnSync(exe, { input: lines.join('\n') + '\n', encoding: 'utf8', maxBuffer: 256 << 20 });
  const s = r.stdout.split('\n').filter((l) => l.startsWith('#STATE ')).map((l) => Object.fromEntries(l.slice(7).split(' ').map((p) => { const [k, v] = p.split('='); return [k, +v]; })));
  const tail = s.slice(-25);
  const t1 = s.find((x) => Math.abs(x.sun) < 1);
  return { end: s[s.length - 1].sun, wob: Math.max(...tail.map((x) => Math.abs(x.sun))), over: Math.max(0, ...s.map((x) => -x.sun)), t1: t1 ? t1.t : NaN };
}

const fmt = (r) => `end ${r.end.toFixed(2).padStart(6)}  last5s ${r.wob.toFixed(2).padStart(5)}  over ${r.over.toFixed(2).padStart(5)}  <1deg ${isNaN(r.t1) ? ' never' : r.t1.toFixed(1).padStart(5) + 's'}`;
const worlds = (process.env.WORLDS || 'drag 0.15|drag 0.15,stick 10|drag 0.15,stick 20|drag 0').split('|');
const teams = (process.env.TEAMS || [
  '', 'adcs.dzc=1', 'adcs.ki=0.5', 'adcs.ki=0.5,adcs.db=0.5', 'adcs.ki=1,adcs.db=0.5', 'adcs.ki=2,adcs.db=0.5',
  'adcs.ki=1,adcs.db=0.5,adcs.dzc=1', 'adcs.ki=1,adcs.db=0.5,adcs.kd=1', 'adcs.ki=1,adcs.db=0.5,adcs.kp=4,adcs.kd=1'].join('|')).split('|');
const strategy = process.env.STRATEGY || 'REACTION';
for (const w of worlds) {
  console.log(`world: ${w}  (${strategy})`);
  for (const t of teams) {
    const team = t ? t.split(',').map((kv) => `TEAM_SET,${kv.replace('=', ',')}`) : [];
    console.log(`  ${(t || 'organizer PD').padEnd(42)} ${fmt(loop(w.split(',').map((x) => x.trim()), team, 30, strategy))}`);
  }
}
