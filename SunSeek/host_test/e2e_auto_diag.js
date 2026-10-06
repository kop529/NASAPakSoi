// AUTO diagnostics + fixes of 6 Oct evening (adcs.wrap, adcs.aw, EVT,TEAM_AUTO, TEAM_CSTREAM, flight recorder, cam.off).
// Part of e2e.js (required at its end); uses the same helpers.
'use strict';

module.exports = ({ run, check, find, all, kv, states, CAL }) => {
  // 6 Oct 15:36 on the rig: AUTO turned ~-1040 deg (3 turns) at rw -40 before it pointed. Cause: the SUN estimate keeps every
  // whole turn made in MANUAL (its correction is taken mod 360) and the organizer error is target - estimate. In this sim the
  // organizer code itself re-inits the estimate at AUTO entry (adcsAuto and the next step in the same ms -> dt 0); on the board
  // the ACK lines over BLE (delay 3 ms each) take longer, so #BLE 1 is needed to see it. Rig: wheel/body ratio 1/50 and a 2.5 s
  // wheel spin-up give ~200 deg/s at 40 % like the log.
  const RIG = ['#SET drag 0.05', '#SET stick 5', '#SET ratio 0.02', '#SET wheelTau 2.5'];
  const BOARD = ['TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5', 'TEAM_SET,rw.slew,500', 'TEAM_SET,adcs.kp,2', 'TEAM_SET,adcs.kd,2',
    'TEAM_SET,adcs.ki,1', 'TEAM_SET,adcs.db,0.5', 'TEAM_SET,adcs.kick,20', 'TEAM_SET,adcs.max,40'];
  const turned = (s) => {
    let tot = 0, mx = 0;
    for (let i = 1; i < s.length; i++) {
      let d = s[i].body - s[i - 1].body;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      tot += d; mx = Math.max(mx, Math.abs(tot));
    }
    return mx;
  };

  console.log('AUTO after 3 turns in MANUAL (15:36 replay, GS on BLE): adcs.wrap + EVT,TEAM_AUTO + TEAM_CSTREAM + recorder');
  {
    const replay = (wrap, tail = []) => {
      const out = run(['#SET drag 0', '#SET rateSign -1', '#SET lamp -18.4', '#WAIT 300', ...CAL, ...BOARD, `TEAM_SET,adcs.wrap,${wrap}`, '#BLE 1',
        '#SET bodyRate 240', '#WAIT 4500', '#SET bodyRate 0', '#SET body 0', ...RIG, '#WAIT 3000',
        'TEAM_CSTREAM,10', 'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO', ...Array.from({ length: 300 }, () => ['#WAIT 100', '#STATE']).flat(), 'STOP', '#WAIT 1000', ...tail]);
      const s = states(out);
      return { out, s, evt: kv(find(out, /^EVT,TEAM_AUTO,ON,/) || 'x'), mx: turned(s), end: s[s.length - 1] };
    };
    const old = replay(0);
    const fix = replay(1, ['TEAM_CSTREAM,0', '#WAIT 200', 'ADCS_MODE,AUTO', '#WAIT 300', 'TEAM_CDUMP', 'STOP', 'TEAM_CREC,2', 'TEAM_CDUMP', '#WAIT 9000',
      'TEAM_CDUMP,50', '#WAIT 500', 'TEAM_CSTREAM,21']);
    console.log(`       wrap 0: EVT ERR ${old.evt.ERR}, body turned up to ${old.mx.toFixed(0)} deg · wrap 1: EVT ERR ${fix.evt.ERR} SYNC ${fix.evt.SYNC}, turned up to ${fix.mx.toFixed(0)} deg, end ${fix.end.sun.toFixed(2)} deg`);
    check('bug reproduced with adcs.wrap 0: the controller sees ~3 turns of error and spins', Math.abs(+old.evt.ERR) > 1000 && old.mx > 360);
    check('adcs.wrap 1: synced to the sun angle, short way (< 60 deg), ends within 2 deg',
      fix.evt.SYNC === '1' && Math.abs(+fix.evt.ERR) < 25 && fix.mx < 60 && Math.abs(fix.end.sun) < 2);
    const ev = find(fix.out, /^EVT,TEAM_AUTO,ON,/) || '';
    check('EVT,TEAM_AUTO,ON carries target, estimate, sun angle, gains, signs',
      /^EVT,TEAM_AUTO,ON,TGT,0\.00,EST,-?[\d.]+,ANG,-?[\d.]+,LIT,1,ERR,[^,]+,KP,2,KD,2,KI,1,SIGN,1,RSIGN,1,MAX,40,DB,0\.5,WRAP,1,SYNC,1,STRAT,RW$/.test(ev), ev);
    check('EVT,TEAM_AUTO,OFF at STOP', !!find(fix.out, /^EVT,TEAM_AUTO,OFF,ERR,/));
    const c = all(fix.out, /^TM,TEAM_C,/).map(kv);
    const inAuto = c.filter((x) => x.M === '1');
    const keys = ['T', 'TGT', 'ANG', 'EST', 'ERR', 'GZ', 'U', 'I', 'K', 'RW', 'LIT', 'H', 'SR', 'SAT'];
    check('TEAM_CSTREAM,10: ~10 lines/s, all keys', inAuto.length >= 290 && inAuto.length <= 310 && keys.every((k) => k in inAuto[5]), `${inAuto.length} lines in AUTO`);
    check('TEAM_CSTREAM keeps going after STOP (M 0), stops at 0, range checked',
      c.filter((x) => x.M === '0').length >= 8 && !!find(fix.out, /^ACK,TEAM_CSTREAM,0$/) && !!find(fix.out, /^ERR,TEAM_CSTREAM_RANGE_0_TO_20$/));
    check('stream: at the end the wheel is not saturated and the error is small', inAuto.slice(-20).every((x) => x.SAT === '0' && Math.abs(+x.ERR) < 2));
    check('TEAM_CDUMP refused in AUTO', !!find(fix.out, /^ERR,TEAM_REQUIRES_MANUAL,TEAM_CDUMP$/));
    const head = kv(find(fix.out, /^TM,TEAM_CR_HEAD,/) || 'x');
    const rows = all(fix.out, /^TM,TEAM_CR,/).map((l) => l.split(',').slice(2).map(Number));
    const ack = find(fix.out, /^ACK,TEAM_CDUMP,\d+$/);
    const ends = all(fix.out, /^EVT,TEAM_CDUMP,END,/);
    // the 2nd AUTO entry (after TEAM_CSTREAM,0) started a new recording: 0.3 s -> ~8 samples
    check('recorder: the short 2nd run replaced the long one', +head.N >= 2 && +head.N <= 15, `N ${head.N}`);
    check('dump: ACK count = rows = END count, step 50 -> 1 row',
      !!ack && ends.length === 2 && +ends[0].split(',')[3] === +ack.split(',')[2] && +ends[1].split(',')[3] === 1, `${ack} ${ends.join(' ')}`);
    check('dump rows have 12 columns + the TEAM_CR_AUTO entry line',
      rows.length >= 3 && rows.every((r) => r.length === 12 && r.every(Number.isFinite)) && !!find(fix.out, /^TM,TEAM_CR_AUTO,ON,TGT,/));
    const long = [...fix.out, ...old.out].filter((l) => !l.startsWith('#') && l.length > 182);
    check('every new line fits one BLE notification (<= 182)', long.length === 0, long[0] || '');

    // the long run itself, from the recorder alone (what a GS run leaves behind)
    const rec = run(['#SET drag 0', '#SET rateSign -1', '#SET lamp -18.4', '#WAIT 300', ...CAL, ...BOARD, '#BLE 1', ...RIG,
      'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO', '#WAIT 30000', 'STOP', 'TEAM_CDUMP', '#WAIT 9000', 'TEAM_CREC,0', 'HELP', '#WAIT 50']);
    const rr = all(rec, /^TM,TEAM_CR,/).map((l) => l.split(',').slice(2).map(Number));
    const dt = rr.length > 1 ? (rr[rr.length - 1][1] - rr[0][1]) / (rr.length - 1) : 0;
    check('recorder: 30 s run at 25 Hz (~750 rows, 40 ms apart), first row = entry angle',
      rr.length >= 740 && rr.length <= 760 && Math.abs(dt - 40) < 1 && Math.abs(rr[0][3] + 18.4) < 1.5, `${rr.length} rows, ${dt.toFixed(1)} ms, ang0 ${rr[0] && rr[0][3]}`);
    check('TEAM_CREC,0 -> off; the 2 team HELP lines fit BLE', !!find(rec, /^ACK,TEAM_CREC,0,N,\d+,FULL,0$/) && all(rec, /^TM,HELP,TEAM_/).length === 2 && all(rec, /^TM,HELP,TEAM_/).every((l) => l.length <= 182));
  }

  console.log('cam.off (camera 90 deg from the sun sensor): target 0 + cam.off 30 -> the lamp ends 30 deg off the sun-sensor axis');
  {
    const out = run(['#SET drag 0.15', '#SET rateSign -1', '#SET lamp 0', '#WAIT 300', ...CAL, 'TEAM_SET,rw.minStart,10', 'TEAM_SET,rw.minStable,5',
      'TEAM_SET,adcs.kp,4', 'TEAM_SET,adcs.kd,1', 'TEAM_SET,adcs.ki,1', 'TEAM_SET,adcs.db,0.5', 'TEAM_SET,cam.off,30', 'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO',
      'TEAM_SET,cam.off,0', ...Array.from({ length: 30 }, () => ['#WAIT 1000', '#STATE']).flat(), 'STOP', '#WAIT 10']);
    const s = states(out);
    const end = s[s.length - 1].sun;
    check('points 30 deg off (within 2 deg), EVT shows TGT 30', Math.abs(end - 30) < 2 && !!find(out, /^EVT,TEAM_AUTO,ON,TGT,30\.00,/), `sun ${end.toFixed(2)}`);
    check('cam.off change refused in AUTO', !!find(out, /^ERR,TEAM_REQUIRES_MANUAL,cam\.off$/));
  }

  // anti-windup: the 15:36 second phase (body stuck near the target, I runs up to the limit, then overshoot)
  console.log('adcs.aw: sticky rig (stick 25), max 40, ki 1, lamp -10 deg, 30 s');
  {
    const aw = (on) => {
      const out = run(['#SET drag 0.15', '#SET stick 25', '#SET rateSign -1', '#SET lamp -10', '#WAIT 300', ...CAL, ...BOARD, `TEAM_SET,adcs.aw,${on}`,
        'ADCS_STRATEGY,REACTION', 'ADCS_MODE,AUTO', ...Array.from({ length: 150 }, () => ['#WAIT 200', '#STATE']).flat(), 'STOP', '#WAIT 10']);
      const s = states(out);
      const over = Math.max(0, ...s.map((x) => x.sun));  // started at -10: past the target = sun > 0
      const t1 = s.find((x) => Math.abs(x.sun) < 1);
      return { over, wob: Math.max(...s.slice(-25).map((x) => Math.abs(x.sun))), t1: t1 ? t1.t : NaN };
    };
    const a0 = aw(0), a1 = aw(1);
    console.log(`       aw 0: overshoot ${a0.over.toFixed(2)}, worst last 5 s ${a0.wob.toFixed(2)}, |e|<1 at ${a0.t1.toFixed(1)} s · aw 1: overshoot ${a1.over.toFixed(2)}, worst ${a1.wob.toFixed(2)}, |e|<1 at ${a1.t1.toFixed(1)} s`);
    check('anti-windup does not make it worse (overshoot, final wobble)', a1.over <= a0.over + 0.5 && a1.wob <= Math.max(1, a0.wob + 0.3));
  }
};
