// Why the simulator never caught the 15:36 bug, and the test that would have:
// 1. timing: every test ran without a BLE central, so adcsAuto and the next control step happened in the same simulated ms
//    -> dt 0 -> the organizer estimator re-initialised itself and hid the k*360 estimate (on the board the BLE ACK lines,
//    delay 3 ms each, prevent that) -> these runs use #BLE 1 (the contest link);
// 2. history: every test started AUTO from a fresh boot with the body still; on the rig the team spins the satellite by
//    hand and with RW kicks first -> random MANUAL history before AUTO;
// 3. physics: the default world (wheel/body 1/400, wheel spin-up 0.35 s) never let the body pass ~30 deg/s; the 15:36 log
//    shows ~230 deg/s at 40 % -> rig closer to the logs (1/50, 2.5 s).
// Invariants after AUTO entry: the body never turns more than 180 deg, never starts the wrong way, ends near the lamp.
// Part of e2e.js (required at its end).
'use strict';

module.exports = ({ run, check, find, kv, states, CAL }) => {
  const RIG = ['#SET drag 0.05', '#SET stick 5', '#SET ratio 0.02', '#SET wheelTau 2.5'];
  const BOARD = ['TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5', 'TEAM_SET,rw.slew,500', 'TEAM_SET,adcs.kp,4', 'TEAM_SET,adcs.kd,2',
    'TEAM_SET,adcs.ki,1', 'TEAM_SET,adcs.db,0.5', 'TEAM_SET,adcs.kick,20', 'TEAM_SET,adcs.max,60', 'TEAM_SET,adcs.lock,1.5', 'TEAM_SET,adcs.unlock,3'];
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  // what the team does with the satellite before pressing AUTO: hand spins, wheel kicks, then it is put down near the lamp
  const history = (seed) => {
    const r = rng(seed);
    const lines = ['#SET drag 0.05'];
    const n = 2 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      if (r() < 0.6) {  // hand push: up to ~1.5 turns
        lines.push(`#SET bodyRate ${((r() < 0.5 ? -1 : 1) * (60 + r() * 220)).toFixed(0)}`, `#WAIT ${1000 + Math.floor(r() * 2500)}`, '#SET bodyRate 0');
      } else {  // wheel kick over BLE, then stop (the wheel gives its momentum back)
        const c = (r() < 0.5 ? -1 : 1) * (25 + Math.floor(r() * 35));
        lines.push(`RW,${c}`, `#WAIT ${800 + Math.floor(r() * 2500)}`, 'RW_STOP', `#WAIT ${1500 + Math.floor(r() * 2000)}`, '#SET bodyRate 0');
      }
      lines.push(`#WAIT ${200 + Math.floor(r() * 800)}`);
    }
    const a = ((r() < 0.5 ? -1 : 1) * (10 + r() * 35));  // put down with the lamp 10..45 deg off
    lines.push(`#SET body ${(-18.4 - a).toFixed(1)}`, '#WAIT 3000');
    return { lines, a };
  };

  const trial = (seed, wrap) => {
    const h = history(seed);
    const out = run(['#SET rateSign -1', '#SET lamp -18.4', '#WAIT 300', ...CAL, ...BOARD, `TEAM_SET,adcs.wrap,${wrap}`, `TEAM_SET,est.wrap,${wrap}`, '#BLE 1', 'ADCS_STRATEGY,REACTION',
      ...h.lines, ...RIG, '#STATE', 'ADCS_MODE,AUTO', ...Array.from({ length: 250 }, () => ['#WAIT 100', '#STATE']).flat(), 'STOP', '#WAIT 10']);
    const s = states(out);
    const s0 = s[0];
    let tot = 0, mx = 0;
    for (let i = 1; i < s.length; i++) {
      let d = s[i].body - s[i - 1].body;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      tot += d; mx = Math.max(mx, Math.abs(tot));
    }
    const early = s.slice(1, 11);  // first second
    const wrongWay = Math.max(...early.map((x) => Math.abs(x.sun))) > Math.abs(s0.sun) + 5;
    const end = s[s.length - 2];
    const evt = kv(find(out, /^EVT,TEAM_AUTO,ON,/) || 'x');
    return { seed, start: s0.sun, err: +evt.ERR, mx, wrongWay, end: end.sun, ok: mx < 180 && !wrongWay && Math.abs(end.sun) < 3 };
  };

  console.log('fuzz: random MANUAL history (hand spins, wheel kicks) before AUTO, GS on BLE, rig like the 15:36 log');
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
  const fixed = seeds.map((sd) => trial(sd, 1));
  const old = seeds.map((sd) => trial(sd, 0));
  for (let i = 0; i < seeds.length; i++) {
    const f = fixed[i], o = old[i];
    console.log(`       seed ${f.seed}: start ${f.start.toFixed(1).padStart(6)} · wrap 1: EVT ERR ${f.err.toFixed(0).padStart(5)}, turned ${f.mx.toFixed(0).padStart(4)}, end ${f.end.toFixed(1).padStart(5)} ${f.ok ? 'ok' : 'BAD'}` +
      ` · wrap 0: EVT ERR ${o.err.toFixed(0).padStart(5)}, turned ${o.mx.toFixed(0).padStart(4)}, end ${o.end.toFixed(1).padStart(6)} ${o.ok ? 'ok' : 'BAD'}`);
  }
  check('every random history: no wrong-way start, < 180 deg turned, ends within 3 deg (adcs.wrap 1)', fixed.every((x) => x.ok),
    fixed.filter((x) => !x.ok).map((x) => `seed ${x.seed}`).join(' '));
  check('the same histories catch the organizer law (adcs.wrap 0 fails at least once)', old.some((x) => !x.ok),
    `${old.filter((x) => !x.ok).length}/${old.length} fail`);
};
