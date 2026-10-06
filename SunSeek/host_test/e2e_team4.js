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
};
