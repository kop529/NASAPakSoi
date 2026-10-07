// standalone runner for host_test/e2e_mission_fuzz.js (same helpers as e2e.js)
const { spawnSync } = require('child_process');
const H = '/mnt/c/TYSC/SunSeek/host_test/';
const exe = H + 'build/sunseek_host';
let p = 0, f = 0;
const check = (n, c, i = '') => { c ? p++ : f++; console.log(`  ${c ? 'ok  ' : 'FAIL'} ${n} ${i}`); };
const run = (lines) => spawnSync(exe, { input: lines.join('\n') + '\n', encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.split('\n').filter((l) => l.length);
const all = (out, re) => out.filter((l) => re.test(l));
const states = (out) => all(out, /^#STATE /).map((l) => Object.fromEntries(l.slice(7).split(' ').map((q) => { const [k, v] = q.split('='); return [k, +v]; })));
const AMB = Math.pow(10000 / 15000, 1 / 0.6) * 0.032 / 0.1;
const CAL = ['TEAM_SET,sun.model,1', `TEAM_SET,sun.aL,${AMB.toFixed(5)}`, `TEAM_SET,sun.aR,${AMB.toFixed(5)}`];
const t0 = Date.now();
require(H + 'e2e_mission_fuzz.js')({ run, check, all, states, CAL });
console.log(`${p} passed, ${f} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
