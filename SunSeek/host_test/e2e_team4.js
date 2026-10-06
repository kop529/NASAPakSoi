// team-4 (audit 7 Oct): estimator MA window 1, no kick inside HOLD, TEAM_SAVE MANUAL-only, STOP reaches the wheel.
// Not testable here: the BLE (core 0) vs loop (core 1) race itself, the UART TX buffer, a failing NVS put, PAYLOAD,RX length.
// Part of e2e.js (required at its end).
'use strict';

module.exports = ({ run, check, find, all, kv, states, CAL }) => {
  const BOARD = ['TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5', 'TEAM_SET,rw.slew,500', 'TEAM_SET,adcs.kp,4', 'TEAM_SET,adcs.kd,2',
    'TEAM_SET,adcs.ki,1', 'TEAM_SET,adcs.db,0.5', 'TEAM_SET,adcs.kick,20', 'TEAM_SET,adcs.max,60', 'TEAM_SET,adcs.lock,1.5', 'TEAM_SET,adcs.unlock,3'];

  console.log('team-4: estimator MA window 1 (MA 10 delays the sun angle ~90 ms; ghold chased its own delayed copy)');
  {
    const st = run(['ESTIMATOR_STATUS', '#WAIT 20']);
    check('default estimator MA window is 1', !!find(st, /EST_MA_WINDOW,1(,|$)/), find(st, /EST_MA_WINDOW/) || 'no status line');
    const go = (ma) => {
      const out = run(['#SET drag 0.15', '#SET stick 10', '#SET rateSign -1', '#SET lamp 0', '#WAIT 300', ...CAL, ...BOARD, `ESTIMATOR_MA_WINDOW,${ma}`,
        'TEAM_SET,adcs.ghold,1', 'TEAM_SET,adcs.retarget,1', 'ADCS_REFERENCE,SUN', 'SET_TARGET,80', 'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO',
        ...Array.from({ length: 40 }, () => ['#WAIT 1000', '#STATE']).flat(), 'STOP', '#WAIT 10']);
      return Math.abs(Math.abs(states(out)[39].sun) - 80);
    };
    const e10 = go(10), e1 = go(1);
    console.log(`       ghold target 80 deg after 40 s: MA 10 off by ${e10.toFixed(1)} deg, MA 1 off by ${e1.toFixed(1)} deg`);
    // measured 7 Oct: MA 10 off 2.6, MA 1 off 2.3 (the rest is the pull near the sensor edge before the lamp counts as lost);
    // the audit's sim (other gains) saw 5.1 vs 0.3 -> the gain here is small, the main MA effect is the lag at speed
    check('ghold with MA 1 ends within 3 deg of 80, not worse than MA 10', e1 < 3 && e1 <= e10 + 0.1, `MA 1 ${e1.toFixed(1)} MA 10 ${e10.toFixed(1)}`);
  }

  console.log('team-4: no kick inside HOLD (rig 20:13: each kick slipped 3-4.5 deg)');
  {
    const out = run(['#SET drag 0.05', '#SET rateSign -1', '#SET lamp 0', '#SET body 0', '#WAIT 300', ...CAL, ...BOARD, 'ADCS_STRATEGY,REACTION',
      'ADCS_MODE,AUTO', '#WAIT 3000', '#SET stick 10', '#SET body 2.2', '#WAIT 8000', '#STATE', '#SET body 6', '#WAIT 8000', '#STATE', 'STOP', '#WAIT 10']);
    const on = out.findIndex((l) => /^EVT,TEAM_HOLD,ON/.test(l));
    const off = out.findIndex((l, i) => i > on && /^EVT,TEAM_HOLD,OFF/.test(l));
    const kicksInHold = on < 0 ? -1 : out.slice(on, off < 0 ? out.length : off).filter((l) => /^EVT,TEAM_KICK/.test(l)).length;
    const s = states(out);
    console.log(`       HOLD ON at line ${on}, HOLD OFF at line ${off}, kicks while in HOLD ${kicksInHold}, sun after 2.2 push ${s[0].sun.toFixed(2)}, after 6 push ${s[1].sun.toFixed(2)}`);
    check('pushed 2.2 deg inside HOLD: no TEAM_KICK while HOLD is on', on >= 0 && kicksInHold === 0);
    check('pushed 6 deg: HOLD OFF and back within 3 deg', off > on && Math.abs(s[1].sun) < 3);
  }

  console.log('team-4: TEAM_SAVE MANUAL-only (a flash write stalls both cores), STOP from AUTO');
  {
    const out = run(['#SET lamp 25', '#WAIT 300', ...CAL, ...BOARD, 'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO', '#WAIT 400', 'TEAM_SAVE', '#WAIT 10',
      '#STATE', 'STOP', '#WAIT 5', '#STATE', 'TEAM_SAVE', '#WAIT 10']);
    const s = states(out);
    check('TEAM_SAVE in AUTO -> ERR,TEAM_REQUIRES_MANUAL,TEAM_SAVE', !!find(out, /^ERR,TEAM_REQUIRES_MANUAL,TEAM_SAVE$/));
    check('TEAM_SAVE after STOP -> ACK', !!find(out, /^ACK,TEAM_SAVE,\d+$/));
    check('STOP: wheel command 0 within 5 ms', s[0].cmd !== 0 && s[1].cmd === 0, `before ${s[0].cmd}, after ${s[1].cmd}`);
  }
  console.log('team-4: F6 - a short I2C glitch in AUTO keeps the wheel command instead of FAULT (wheel coast -> body spins)');
  {
    const go = (miss) => {
      const out = run(['#SET drag 0.05', '#SET rateSign -1', '#SET lamp 0', '#SET body 0', '#WAIT 300', ...CAL, ...BOARD, `TEAM_SET,adcs.miss,${miss}`,
        'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO', '#WAIT 4000', '#SET i2cDown 60', '#WAIT 3000', '#STATE', 'STOP', '#WAIT 10']);
      return { out, fault: !!find(out, /^EVT,TEAM_AUTO,FAULT/), rec: find(out, /^EVT,TEAM_ADCS_MISS,RECOVERED/) || '', s: states(out)[0] };
    };
    const org = go(0), team = go(5);
    console.log(`       60 ms glitch: adcs.miss 0 -> FAULT ${org.fault} · adcs.miss 5 -> FAULT ${team.fault}, ${team.rec}, sun ${team.s.sun.toFixed(2)}`);
    check('adcs.miss 0 = organizer: one glitch -> FAULT', org.fault);
    check('adcs.miss 5: a 60 ms glitch -> no FAULT, RECOVERED, still on target', !team.fault && /RECOVERED/.test(team.rec) && Math.abs(team.s.sun) < 2);
    const long = run(['#SET lamp 0', '#WAIT 300', ...CAL, ...BOARD, 'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO', '#WAIT 1000', '#SET i2cDown 500', '#WAIT 1000', 'STOP', '#WAIT 10']);
    check('a long outage (500 ms) still ends in FAULT', !!find(long, /^EVT,TEAM_ADCS_MISS,FAULT,6$/) && !!find(long, /^EVT,TEAM_AUTO,FAULT/));
  }
  console.log('team-5: BLE writes are queued and run in loop() (7 Oct: GS PREPARE burst lost ACK,ADCS_PREPARE + EVT,ADCS_READY)');
  {
    const out = run(['#SET lamp 0', '#WAIT 300', '#BLE 1', 'TM_STREAM,ADCS,ON', '#WAIT 200', '#BLEW ADCS_STRATEGY,REACTION', '#BLEW ADCS_TUNE,4.000,2.000,40.0',
      '#BLEW SET_TARGET,0.0', '#BLEW ADCS_PREPARE', '#WAIT 100']);
    const want = [/^ACK,ADCS_STRATEGY/, /^ACK,ADCS_TUNE/, /^ACK,SET_TARGET/, /^ACK,ADCS_PREPARE$/, /^EVT,ADCS_READY$/];
    check('GS PREPARE burst over BLE: every reply comes back, in order', want.every((re) => !!find(out, re)) &&
      want.map((re) => out.findIndex((l) => re.test(l))).every((v, i, a) => !i || v > a[i - 1]));
    const st = run(['#SET drag 0', '#SET lamp 0', '#WAIT 300', ...CAL, '#SET bodyRate 240', '#WAIT 3500', '#SET bodyRate 0', '#SET body -20', '#WAIT 6000', '#STATE', 'ESTIMATOR_STATUS', '#WAIT 20']);
    const sun = states(st)[0].sun;
    const est = +((find(st, /EST_ANGLE,/) || '').match(/EST_ANGLE,(-?[\d.]+)/) || [0, NaN])[1];
    check('SUN estimate stays in +-180 after 2+ turns by hand (est.wrap 1)', Math.abs(est) <= 180 && Math.abs(est - sun) < 2, `EST_ANGLE ${est} sun ${sun.toFixed(2)}`);
  }
  console.log('team-4: compass - MAG_CAL_STOP now applies the hard-iron offset (organizer: only reported, #define offsets 0)');
  {
    const at = [0, 90, 180, 270];
    const measure = () => at.flatMap((b) => [`#SET body ${b}`, '#WAIT 600', '#STATE']);
    const out = run(['#SET drag 0', '#SET north 0', '#SET magOx 1750', '#SET magOy 1240', '#SET magSy 1.1', '#WAIT 300', 'TM_STREAM,MAG,ON', ...measure(),
      'MAG_CAL_START', '#SET bodyRate 60', '#WAIT 7000', '#SET bodyRate 0', 'MAG_CAL_STOP', '#WAIT 20', ...measure(), 'TEAM_INFO', '#WAIT 20']);
    let hd = NaN; const res = [];
    for (const l of out) {
      const m = l.match(/^TM,MAG_X,.*MAG_HEADING,(-?[\d.]+)/); if (m) hd = +m[1];
      // sim: heading = north - body (north 0) -> heading + body should be 0 (mod 360)
      if (l.startsWith('#STATE ')) { const body = +l.match(/body=(-?[\d.]+)/)[1]; const e = ((hd + body) % 360 + 540) % 360 - 180; res.push(Math.abs(e)); }
    }
    const before = Math.max(...res.slice(0, 4)), after = Math.max(...res.slice(4, 8));
    const ev = find(out, /^EVT,TEAM_MAG_CAL,/) || 'none';
    console.log(`       rig-like offset (28, 20) uT + y scale 1.1: heading error before ${before.toFixed(1)} deg, after MAG_CAL ${after.toFixed(1)} deg · ${ev}`);
    check('MAG_CAL_STOP applies the offset (EVT,TEAM_MAG_CAL,APPLIED) and the compass error drops below 3 deg', /APPLIED/.test(ev) && before > 20 && after < 3, ev);
    check('compass params are UNSAVED until TEAM_SAVE', !!find(out, /^TM,TEAM_FW,.*UNSAVED,[1-9]/));
  }
};
